import {useEffect, useState} from "preact/hooks";
import {ActionIcon, Feedback, extensionRequest} from "./ui-components.js";

export function DiscogsSettings() {
  const [token, setToken] = useState("");
  const [configured, setConfigured] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  useEffect(() => {
    void extensionRequest<{configured: boolean}>({type: "discogs:status"}).then(result => setConfigured(result.configured))
      .catch(() => setFeedback("Não foi possível ler a configuração Discogs."));
  }, []);
  async function update(remove = false) {
    setBusy(true);
    try {
      const result = await extensionRequest<{configured: boolean}>(remove ? {type: "discogs:clear"} : {type: "discogs:configure", token});
      setConfigured(result.configured);
      setToken("");
      setFeedback(remove ? "Token removido." : "Token pessoal salvo neste navegador.");
    } catch (error) {setFeedback(error instanceof Error ? error.message : "Não foi possível salvar.");}
    finally {setBusy(false);}
  }
  return <details id="discogs-settings" class="settings-section card card-border">
    <summary><span class="section-title">Credencial Discogs</span><span class="section-badge badge badge-soft">{configured ? "Token configurado" : "Sem token"}</span></summary>
    <div class="section-content">
      <p class="note">Token pessoal para consultar dados de edições físicas em Música e Vídeo.</p>
      <form onSubmit={event => {event.preventDefault(); void update();}}>
        <label for="discogs-token">Token pessoal Discogs</label>
        <input id="discogs-token" class="input w-full" type="password" autoComplete="off" spellcheck={false}
          disabled={busy} required value={token} placeholder={configured ? "Digite outro token para substituir" : "Cole seu token pessoal"}
          onInput={event => setToken(event.currentTarget.value)}/>
        <div class="settings-actions">
          <button class="btn btn-primary" disabled={busy || !token.trim()}><ActionIcon name="save"/>Salvar token</button>
          <button class="btn btn-soft" type="button" disabled={busy || !configured} onClick={() => void update(true)}><ActionIcon name="trash"/>Remover token</button>
        </div>
      </form>
      <Feedback id="discogs-feedback">{feedback}</Feedback>
      <p class="note"><a href="https://www.discogs.com/settings/developers" target="_blank" rel="noopener noreferrer">Gerar token pessoal no Discogs</a></p>
      <p class="note">This application uses Discogs’ API but is not affiliated with, sponsored or endorsed by Discogs. ‘Discogs’ is a trademark of Zink Media, LLC.</p>
    </div>
  </details>;
}
