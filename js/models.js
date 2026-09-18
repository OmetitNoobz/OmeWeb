/**
 * OmeRyth Web - Data Models
 * Modèles de données compatibles 100% avec OmeRyth Desktop (RHYTHMO_V5).
 */

export const SeparatorType = Object.freeze({
  START: 'START',
  INNER: 'INNER',
  END: 'END',
  LEGACY: 'LEGACY'
});

export const SignType = Object.freeze({
  DEFAULT: { id: 'DEFAULT', badge: '', color: '#888888', label: 'Standard' },
  MPB: { id: 'MPB', badge: 'M', color: '#ff5a96', label: 'Labiale (M, P, B)' },
  FVR: { id: 'FVR', badge: 'F', color: '#00beff', label: 'Dentale (F, V, R)' },
  NEUTRAL: { id: 'NEUTRAL', badge: 'N', color: '#b496e6', label: 'Neutre' },
  OPEN_A: { id: 'OPEN_A', badge: 'A', color: '#ffbe00', label: 'Grande ouverture (A)' },
  RESPIRATION: { id: 'RESPIRATION', badge: 'h/', color: '#46d2c8', label: 'Respiration / Souffle' }
});

export class Role {
  constructor(name = 'Narrateur', color = '#4ECDC4') {
    this.name = name;
    this.color = typeof color === 'number' ? Role.intToHex(color) : color;
  }

  static intToHex(colorInt) {
    const hex = (colorInt & 0xFFFFFF).toString(16).padStart(6, '0');
    return `#${hex}`;
  }

  static hexToInt(hexStr) {
    if (!hexStr) return -1;
    const clean = hexStr.replace('#', '');
    return parseInt(clean, 16) | 0xFF000000;
  }
}

export class TextItem {
  constructor(text = '', x = 0, band = 0, role = null) {
    this.text = text;
    this.x = Math.round(x);
    this.band = Math.max(0, band);
    this.role = role; // Instance of Role or null
  }
}

export class SeparatorMark {
  constructor(x = 0, type = SeparatorType.START, splitIndex = -1, signType = 'DEFAULT', rawDetxType = null) {
    this.x = Math.round(x);
    this.type = type;
    this.splitIndex = splitIndex;
    this.signType = signType;
    this.rawDetxType = rawDetxType;
  }

  isStartBoundary() {
    return this.type === SeparatorType.START || this.type === SeparatorType.LEGACY;
  }

  isEndBoundary() {
    return this.type === SeparatorType.END || this.type === SeparatorType.LEGACY;
  }
}
