// Sheet geometry in mm. Must stay identical to python/layout.py so sheets work with both.

export const PAGE_W = 210;
export const PAGE_H = 297;

export const LOWER = "abcdefghijklmnopqrstuvwxyz";
export const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
export const DIGITS = "0123456789";
export const PUNCT = ".,;:!?'\"()[]-/&@#%+=*$<>_";
export const CHARSET = LOWER + UPPER + DIGITS + PUNCT + "äöüßÄÖÜẞ€£¥¢§‰{}\\|~^`„“”‘’‚«»–—−•…×÷±≤≥≠≈∞√∛∑∏∫∂∇∈∉∅∩∪→←↑↓↔⇒⇔°·☉⊕¹²³⁰⁴⁵⁶⁷⁸⁹⁺⁻₀₁₂₃₄₅₆₇₈₉₊₋½¼¾µαβγδεζηθικλμνξοπρστυφχψωΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩéèêáàâíìîóòôúùûçñÉÈÊÁÀÂÍÌÎÓÒÔÚÙÛÇÑ";

export const LABELS = {
  l: "l  (small L)", I: "I  (capital i)", O: "O  (letter)", 0: "0  (zero)",
  1: "1  (one)", ".": ".  period", ",": ",  comma", ";": ";  semicolon",
  ":": ":  colon", "'": "'  apostrophe", '"': '"  quote', "-": "-  dash",
  _: "_  underscore", "/": "/  slash", "*": "*  star",
};

export const VARIANTS = 3;
export const GROUPS_PER_ROW = 3;
export const ROWS_PER_PAGE = 10;

export const MARKER_SIZE = 8;
export const MARKER_CENTERS = [[15, 15], [195, 15], [195, 282], [15, 282]];

export const CONTENT_X0 = 20;
export const CONTENT_Y0 = 24;
export const BOX_W = 18;
export const BOX_H = 19;
export const BASELINE = 13;
export const GROUP_GAP = 4;
export const LABEL_H = 4;
export const ROW_GAP = 2;
export const ROW_PITCH = LABEL_H + BOX_H + ROW_GAP;

export const MAX_PAGES = 9;
export const PAGE_ID_SIZE = 4;

export const groupX = (group) => CONTENT_X0 + group * (VARIANTS * BOX_W + GROUP_GAP);
export const rowY = (row) => CONTENT_Y0 + row * ROW_PITCH;

export function boxRect(row, group, variant) {
  const x0 = groupX(group) + variant * BOX_W;
  const y0 = rowY(row) + LABEL_H;
  return [x0, y0, x0 + BOX_W, y0 + BOX_H];
}

export const pageIdCenter = (k) => [90 + k * 10, 282];

export function sheets() {
  const per = ROWS_PER_PAGE * GROUPS_PER_ROW;
  const out = [];
  for (let i = 0; i < CHARSET.length; i += per) out.push(CHARSET.slice(i, i + per));
  return out;
}
