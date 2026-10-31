/** YouTube link helpers shared by the transcript and video routes. */

export function extractVideoId(input) {
  const s = String(input);
  const m = s.match(/(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([A-Za-z0-9_-]{11})/) || s.match(/^([A-Za-z0-9_-]{11})$/);
  return m ? m[1] : null;
}

export const canonicalUrl = (videoId) => `https://www.youtube.com/watch?v=${videoId}`;
