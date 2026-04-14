const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const NODE_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
  }
  for (let i = 0; i < length; i += 1) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

function randomFromAlphabet(length, alphabet) {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

export function generateRoomId(length = 8) {
  return randomFromAlphabet(length, ROOM_ALPHABET);
}

export function generateNodeId(prefix = "f", length = 10) {
  return `${prefix}_${randomFromAlphabet(length, NODE_ALPHABET)}`;
}
