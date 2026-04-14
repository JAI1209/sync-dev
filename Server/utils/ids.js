/**
 * ID generation utilities for server
 */

const crypto = require("crypto");

const NODE_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function randomFromAlphabet(length, alphabet) {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

function generateNodeId(prefix = "f", length = 10) {
  return `${prefix}_${randomFromAlphabet(length, NODE_ALPHABET)}`;
}

module.exports = { generateNodeId };
