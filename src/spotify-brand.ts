export function spotifyIcon(): HTMLImageElement {
  const image = document.createElement("img");
  image.src = chrome.runtime.getURL("spotify-icon.svg");
  image.className = "spotify-icon";
  image.alt = "";
  image.setAttribute("aria-hidden", "true");
  image.width = 24;
  image.height = 24;
  return image;
}

export function youtubeMusicIcon(): HTMLImageElement {
  const image = spotifyIcon();
  image.src = chrome.runtime.getURL("youtube-music-icon.png");
  image.classList.add("youtube-music-icon");
  return image;
}
