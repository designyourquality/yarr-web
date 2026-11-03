// 미리 듣기 합성 (화면이 멈추지 않게 따로 돌려요) · seq-core.js 의 renderPreviewFromJson
import { renderPreviewFromJson } from './seq-core.js?v=20261105';

self.onmessage = (e) => {
  const { id, json, bpm } = e.data;
  try {
    const r = renderPreviewFromJson(json, bpm);
    const levels = r.levels;
    const transfer = [r.wav.buffer, ...Object.values(levels).map((a) => a.buffer)];
    self.postMessage({ id, wav: r.wav, levels }, transfer);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
