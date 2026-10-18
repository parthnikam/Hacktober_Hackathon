export function mixToMono(chunks) {
  let length = 0;
  for (const chunk of chunks || []) length += chunk.length;
  const mixed = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks || []) {
    mixed.set(chunk, offset);
    offset += chunk.length;
  }
  return mixed;
}

export function downsample(samples, fromRate, toRate) {
  const input = samples instanceof Float32Array ? samples : Float32Array.from(samples || []);
  const from = Math.round(fromRate);
  const to = Math.round(toRate);
  if (!input.length || !from || !to || from === to) return input;
  const ratio = from / to;
  const length = Math.floor(input.length / ratio);
  const output = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.max(start + 1, Math.min(input.length, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    output[i] = sum / (end - start);
  }
  return output;
}

export function encodeWav(samples, sampleRate) {
  const data = samples instanceof Float32Array ? samples : Float32Array.from(samples || []);
  const bytes = new Uint8Array(44 + data.length * 2);
  const view = new DataView(bytes.buffer);
  const write = (offset, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + data.length * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, data.length * 2, true);
  let offset = 44;
  for (let i = 0; i < data.length; i++) {
    const sample = Math.max(-1, Math.min(1, data[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }
  return bytes;
}
