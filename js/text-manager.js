/**
 * OmeRyth Web - Text & Separator Manager
 * Gestion de l'état de la bande rythmo : textes, séparateurs, signes lipsync, repères de plans et historique Undo/Redo.
 */

import { TextItem, SeparatorMark, SeparatorType, Role } from './models.js';

export class TextManager {
  constructor(bandCount = 4) {
    this.bandCount = bandCount;
    this.texts = [];
    this.bandSeparators = new Map(); // bandIndex -> Array<SeparatorMark>
    this.planMarkers = []; // Array of integer worldX
    this.roles = [
      new Role('Narrateur', '#4ECDC4'),
      new Role('Personnage 1', '#FF6B6B'),
      new Role('Personnage 2', '#FFD166'),
      new Role('Personnage 3', '#A06CD5')
    ];

    this.undoStack = [];
    this.redoStack = [];
    this.maxHistory = 60;
    this.initBands();
  }

  initBands() {
    for (let b = 0; b < this.bandCount; b++) {
      if (!this.bandSeparators.has(b)) {
        this.bandSeparators.set(b, []);
      }
    }
  }

  setBandCount(count) {
    this.recordSnapshot();
    this.bandCount = Math.max(1, count);
    this.initBands();
  }

  // --- Snapshot / Undo / Redo ---
  recordSnapshot() {
    const snapshot = {
      bandCount: this.bandCount,
      texts: this.texts.map(t => new TextItem(t.text, t.x, t.band, t.role ? new Role(t.role.name, t.role.color) : null)),
      separators: [],
      planMarkers: [...this.planMarkers],
      roles: this.roles.map(r => new Role(r.name, r.color))
    };

    for (const [band, seps] of this.bandSeparators.entries()) {
      for (const s of seps) {
        snapshot.separators.push({
          band,
          x: s.x,
          type: s.type,
          splitIndex: s.splitIndex,
          signType: s.signType,
          rawDetxType: s.rawDetxType
        });
      }
    }

    this.undoStack.push(snapshot);
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }

  undo() {
    if (this.undoStack.length === 0) return false;
    const current = {
      bandCount: this.bandCount,
      texts: this.texts.map(t => new TextItem(t.text, t.x, t.band, t.role ? new Role(t.role.name, t.role.color) : null)),
      separators: [],
      planMarkers: [...this.planMarkers],
      roles: this.roles.map(r => new Role(r.name, r.color))
    };
    for (const [band, seps] of this.bandSeparators.entries()) {
      for (const s of seps) {
        current.separators.push({
          band,
          x: s.x,
          type: s.type,
          splitIndex: s.splitIndex,
          signType: s.signType,
          rawDetxType: s.rawDetxType
        });
      }
    }
    this.redoStack.push(current);

    const prev = this.undoStack.pop();
    this.restoreSnapshot(prev);
    return true;
  }

  redo() {
    if (this.redoStack.length === 0) return false;
    const next = this.redoStack.pop();
    this.recordSnapshot();
    this.restoreSnapshot(next);
    return true;
  }

  restoreSnapshot(s) {
    this.bandCount = s.bandCount;
    this.texts = s.texts.map(t => new TextItem(t.text, t.x, t.band, t.role ? new Role(t.role.name, t.role.color) : null));
    this.planMarkers = [...s.planMarkers];
    this.roles = s.roles.map(r => new Role(r.name, r.color));

    this.bandSeparators.clear();
    this.initBands();
    for (const sep of s.separators) {
      this.addSeparatorDirect(sep.band, new SeparatorMark(sep.x, sep.type, sep.splitIndex, sep.signType, sep.rawDetxType));
    }
  }

  // --- Text Items ---
  addTextItem(item, record = true) {
    if (record) this.recordSnapshot();
    this.texts.push(item);
    return item;
  }

  removeTextItem(item, record = true) {
    if (record) this.recordSnapshot();
    const idx = this.texts.indexOf(item);
    if (idx !== -1) {
      this.texts.splice(idx, 1);
      return true;
    }
    return false;
  }

  findTextAt(band, worldX, pps = 80) {
    for (const t of this.texts) {
      if (t.band !== band) continue;
      const bounds = this.getBoundarySeparators(band, t.x);
      const startX = bounds.leftSep !== null ? bounds.leftSep : t.x;
      const endX = bounds.rightSep !== null ? bounds.rightSep : startX + Math.max(100, t.text.length * 15);
      if (worldX >= startX - 10 && worldX <= endX + 10) {
        return t;
      }
    }
    return null;
  }

  // --- Separators ---
  addSeparatorDirect(band, sep) {
    if (!this.bandSeparators.has(band)) {
      this.bandSeparators.set(band, []);
    }
    const list = this.bandSeparators.get(band);
    // Supprimer si existant au même X exact
    const existIdx = list.findIndex(m => m.x === sep.x);
    if (existIdx !== -1) {
      list.splice(existIdx, 1);
    }
    list.push(sep);
    list.sort((a, b) => a.x - b.x);
    return sep;
  }

  addSeparator(band, x, type = SeparatorType.START, splitIndex = -1, signType = 'DEFAULT', rawDetxType = null, record = true) {
    if (record) this.recordSnapshot();
    const mark = new SeparatorMark(x, type, splitIndex, signType, rawDetxType);
    return this.addSeparatorDirect(band, mark);
  }

  removeSeparator(band, x, record = true) {
    const list = this.bandSeparators.get(band);
    if (!list) return false;
    const idx = list.findIndex(m => Math.abs(m.x - x) <= 6);
    if (idx !== -1) {
      if (record) this.recordSnapshot();
      list.splice(idx, 1);
      return true;
    }
    return false;
  }

  moveSeparator(band, oldX, newX) {
    const list = this.bandSeparators.get(band);
    if (!list) return false;
    const item = list.find(m => m.x === oldX);
    if (item) {
      item.x = Math.round(newX);
      list.sort((a, b) => a.x - b.x);
      return true;
    }
    return false;
  }

  findSeparatorAt(band, worldX, tolerance = 10) {
    const list = this.bandSeparators.get(band);
    if (!list) return null;
    let closest = null;
    let minD = tolerance;
    for (const m of list) {
      const d = Math.abs(m.x - worldX);
      if (d <= minD) {
        minD = d;
        closest = m;
      }
    }
    return closest;
  }

  getBoundarySeparators(band, itemX) {
    const list = this.bandSeparators.get(band);
    let leftSep = null;
    let rightSep = null;
    const innerMarks = [];

    if (!list || list.length === 0) {
      return { leftSep, rightSep, innerMarks };
    }

    // Trouver le START le plus proche à gauche (<= itemX)
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i];
      if (s.x > itemX) continue;
      if (s.isStartBoundary()) {
        leftSep = s.x;
        break;
      }
      if (s.isEndBoundary() && s.x < itemX) {
        break; // Dépassé la fin de la réplique précédente
      }
    }

    // Trouver le END le plus proche à droite (>= itemX)
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (s.x < itemX) continue;
      if (s.isEndBoundary()) {
        rightSep = s.x;
        break;
      }
      if (s.isStartBoundary() && s.x > itemX) {
        break; // Nouvelle réplique commence à droite
      }
    }

    const startX = leftSep !== null ? leftSep : itemX;
    const endX = rightSep !== null ? rightSep : Infinity;

    // Collecter les séparateurs INNER situés strictement entre startX et endX
    for (const m of list) {
      if (m.x > startX && m.x < endX && m.type === SeparatorType.INNER) {
        innerMarks.push(m);
      }
    }

    return { leftSep, rightSep, innerMarks };
  }

  deletePhraseAtStart(band, startX, record = true) {
    if (record) this.recordSnapshot();
    const list = this.bandSeparators.get(band) || [];

    // Trouver la fin de la réplique (le END correspondant ou le prochain START)
    let endX = Infinity;
    let endSep = null;
    for (const s of list) {
      if (s.x > startX) {
        if (s.isEndBoundary()) {
          endX = s.x;
          endSep = s;
          break;
        }
        if (s.isStartBoundary()) {
          endX = s.x;
          break;
        }
      }
    }

    // Supprimer le(s) texte(s) associé(s) à cette réplique sur cette bande
    const removedTexts = [];
    this.texts = this.texts.filter(t => {
      if (t.band !== band) return true;
      const isInPhrase = (Math.abs(t.x - startX) <= 35) || (t.x >= startX - 10 && t.x < endX);
      if (isInPhrase) {
        removedTexts.push(t);
        return false;
      }
      return true;
    });

    // Supprimer le START, les INNER intermédiaires, et le END associé
    const remainingSeps = list.filter(s => {
      if (s.x === startX) return false;
      if (s.x > startX && s.x < endX) return false;
      if (endSep && s === endSep) return false;
      return true;
    });
    this.bandSeparators.set(band, remainingSeps);

    return { removedTexts, endX };
  }

  findPhraseInfoAt(band, worldX) {
    const list = this.bandSeparators.get(band) || [];
    let startSep = null;
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i];
      if (s.x <= worldX + 15 && s.isStartBoundary()) {
        startSep = s;
        break;
      }
      if (s.x < worldX && s.isEndBoundary()) {
        break;
      }
    }
    if (!startSep) return null;

    let endSep = null;
    for (const s of list) {
      if (s.x > startSep.x) {
        if (s.isEndBoundary()) {
          endSep = s;
          break;
        }
        if (s.isStartBoundary()) {
          break;
        }
      }
    }

    const endX = endSep ? endSep.x : Infinity;
    const textItem = this.texts.find(t => t.band === band && (Math.abs(t.x - startSep.x) <= 35 || (t.x >= startSep.x - 10 && t.x < endX)));

    return {
      startSep,
      endSep,
      textItem,
      startX: startSep.x,
      endX
    };
  }

  // --- Plan Markers ---
  addPlanMarker(x, record = true) {
    const snapped = Math.round(x);
    if (this.planMarkers.includes(snapped)) return false;
    if (record) this.recordSnapshot();
    this.planMarkers.push(snapped);
    this.planMarkers.sort((a, b) => a - b);
    return true;
  }

  removePlanMarker(x, record = true) {
    const idx = this.planMarkers.findIndex(mx => Math.abs(mx - x) <= 8);
    if (idx !== -1) {
      if (record) this.recordSnapshot();
      this.planMarkers.splice(idx, 1);
      return true;
    }
    return false;
  }

  movePlanMarker(oldX, newX) {
    const idx = this.planMarkers.findIndex(mx => mx === oldX);
    if (idx !== -1) {
      this.planMarkers[idx] = Math.round(newX);
      this.planMarkers.sort((a, b) => a - b);
      return true;
    }
    return false;
  }

  findPlanMarkerAt(worldX, tolerance = 10) {
    let closest = null;
    let minD = tolerance;
    for (const mx of this.planMarkers) {
      const d = Math.abs(mx - worldX);
      if (d <= minD) {
        minD = d;
        closest = mx;
      }
    }
    return closest;
  }

  // --- Roles ---
  getRoleByName(name) {
    if (!name) return null;
    return this.roles.find(r => r.name.toLowerCase() === name.toLowerCase()) || null;
  }

  addRole(role) {
    const existing = this.getRoleByName(role.name);
    if (existing) {
      existing.color = role.color;
      return existing;
    }
    this.roles.push(role);
    return role;
  }
}
