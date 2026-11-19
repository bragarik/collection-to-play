import {isLastfmSourceId, lastfmQuery, parseLastfmAlbum, type LastfmAlbum, type LastfmAlbumMatch} from "../streamings/lastfm.js";
import type {AlbumCandidate} from "../shared/contracts.js";
import {formatDescriptionText, type AlbumDescription,type DescriptionSection} from "./album-description.js";
import {AlbumArtworkResource, type ArtworkInput} from "./album-artwork.js";

/** Complementary source: independent of streaming slots, playback and catalog writes. */
export class LastfmSource {
  private readonly data: LastfmAlbum;
  private artwork: AlbumArtworkResource | undefined;
  private disposed = false;
  readonly id: string;
  constructor(value: LastfmAlbum) {
    const query=lastfmQuery({title:value?.title,artist:value?.artist,language:value?.requestedLanguage});
    const plain = (value: unknown): unknown => typeof value === "string" ? value.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;") : value;
    const {rawAbout, rawSummary, ...parsed}=parseLastfmAlbum({album:{name:value.title,artist:value.artist,url:value.url,mbid:value.mbid,
      image:value.artworkUrl?[{"#text":value.artworkUrl}]:[],tags:{tag:value.tags?.map(name=>({name}))},
      tracks:{track:value.tracks?.map(track=>({name:track.title,duration:track.durationSeconds,"@attr":{rank:track.number}}))},
      wiki:{content:value.rawAbout ?? plain(value.about),summary:value.rawSummary ?? plain(value.summary)}}},query);
    this.data={...parsed, ...(value.rawAbout !== undefined && rawAbout !== undefined ? {rawAbout} : {}),
      ...(value.rawSummary !== undefined && rawSummary !== undefined ? {rawSummary} : {})};
    if(this.data.status!=="ready")throw new Error("O Last.fm não forneceu dados suficientes para aproveitar este resultado.");
    this.id=this.data.url+"#"+this.data.requestedLanguage;
    if(!isLastfmSourceId(this.id))throw new Error("Identidade Last.fm inválida.");
  }
  private active(): void {if(this.disposed)throw new Error("A fonte Last.fm foi encerrada.");}
  snapshot(): LastfmAlbum {this.active();return structuredClone(this.data);}
  artworkInput(): ArtworkInput {this.active();return {service:"lastfm",id:this.id,...(this.data.artworkUrl?{artworkUrl:this.data.artworkUrl}:{})};}
  setArtwork(resource: AlbumArtworkResource): void {
    this.active();if(resource.metadata.service!=="lastfm"||resource.metadata.albumId!==this.id)throw new Error("Capa de outra fonte.");
    const previous=this.artwork;this.artwork=resource.retain();previous?.release();
  }
  artworkResource(): AlbumArtworkResource | undefined {this.active();return this.artwork;}
  sections(): readonly DescriptionSection[] {
    this.active();const data=this.data;
    const sections:DescriptionSection[]=[{field:"title",label:"Álbum",text:`Álbum: ${data.title}`},{field:"artists",label:"Artistas",text:`Artistas: ${data.artist}`}];
    if(data.tags.length)sections.push({field:"tags",label:"Tags",text:`Tags: ${data.tags.join(", ")}`});
    if(data.mbid)sections.push({field:"mbid",label:"MusicBrainz",text:`MusicBrainz: ${data.mbid}`});
    const about=data.about??data.summary;
    if(about)sections.push({field:"about",label:"Sobre o álbum",text:`Sobre o álbum:\n${about}`});
    if(data.tracks.length)sections.push({field:"tracks",label:"Faixas",text:"Faixas:\n"+data.tracks.map(track=>{
      const duration=track.durationSeconds;return `${track.number?`${track.number}. `:"- "}${track.title}${duration?` — ${Math.floor(duration/60)}:${String(duration%60).padStart(2,"0")}`:""}`;
    }).join("\n")});
    return sections;
  }
  description(): string {
    return formatDescriptionText(this.sections(), {service: "lastfm", url: this.data.url,
      ...(this.data.about || this.data.summary ? {sourceCredit: `Termos da API Last.fm: ${this.data.attribution.licenseUrl}`} : {})}, {preserveLongText: true});
  }
  dispose(): void {if(!this.disposed){this.disposed=true;this.artwork?.release();this.artwork=undefined;}}
}


export function lastfmSearchCandidate(value: LastfmAlbumMatch): AlbumCandidate {
  return {service: "lastfm", id: value.url + "#" + value.requestedLanguage, title: value.title,
    artists: [{id: value.artist, name: value.artist}], url: value.url, ...(value.artworkUrl ? {artworkUrl: value.artworkUrl} : {})};
}
export function lastfmCandidate(value: LastfmAlbum): AlbumCandidate {
  const source=new LastfmSource(value);
  try {const data=source.snapshot();return {service:"lastfm",id:source.id,title:data.title,artists:[{id:data.artist,name:data.artist}],url:data.url,lastfm:data,...(data.artworkUrl?{artworkUrl:data.artworkUrl}:{})};}
  finally {source.dispose();}
}
export function lastfmDescription(candidate: AlbumCandidate): AlbumDescription {
  if(candidate.service!=="lastfm"||!candidate.lastfm)throw new Error("Resultado Last.fm inválido.");
  const source=new LastfmSource(candidate.lastfm);
  try {
    const data=source.snapshot();
    if(source.id!==candidate.id||data.url!==candidate.url||data.title!==candidate.title||candidate.artists.length!==1||candidate.artists[0]?.name!==data.artist)throw new Error("A identidade do álbum Last.fm mudou.");
    const manualFields: Record<string, string> = {};
    const manualFieldNotes: Record<string, string> = {};
    const notes = data.rawAbout ?? data.rawSummary ?? data.about ?? data.summary;
    if (notes?.trim()) manualFields["notes"] = notes;
    if (data.tags.length) manualFields["tags"] = data.tags.join(", ");
    const timedTracks = data.tracks.filter(track => track.durationSeconds !== undefined);
    const seconds = timedTracks.reduce((total, track) => total + track.durationSeconds!, 0);
    if (Number.isSafeInteger(seconds) && Math.round(seconds / 60) > 0) {
      manualFields["length_of"] = String(Math.round(seconds / 60));
      manualFieldNotes["length_of"] = `Soma das durações disponíveis de ${timedTracks.length} das ${data.tracks.length} faixas retornadas, arredondada para minutos. A lista pode ser parcial.`;
    }
    return {manualFields,manualFieldNotes,service:"lastfm",albumId:source.id,text:source.description(),listedTracks:data.tracks.length,sections:source.sections(),attribution:{fields:["about"],text:`Termos da API Last.fm: ${data.attribution.licenseUrl}`},fields:["title","artists"],
      notes:[`Last.fm: consulta em ${data.requestedLanguage==="pt"?"Português":"Inglês"}; o idioma recebido pode ser diferente.`,...(!data.about&&!data.summary?["Sobre o álbum não fornecido neste idioma."]:[]),"Tags não equivalem a gêneros; a lista retornada não comprova completude da edição."]};
  } finally {source.dispose();}
}
