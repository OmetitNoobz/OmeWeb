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

    // État d'édition dynamique en direct sur la bande rythmo (Desktop OmeRyth)
    this.isEditing = false;
    this.editingText = null;
    this.editingBand = -1;
    this.cursorIndex = 0;
    this.caretVisible = false;
    this.originalEditingText = '';
    this.isNewPhraseBeingCreated = false;

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
      const mark = list[idx];
      // Si c'est un START, supprimer ou détacher le TextItem associé
      if (mark.isStartBoundary()) {
        const textIdx = this.texts.findIndex(t => t.band === band && Math.abs(t.x - mark.x) <= 35);
        if (textIdx !== -1) {
          this.texts.splice(textIdx, 1);
        }
      }
      list.splice(idx, 1);
      return true;
    }
    return false;
  }

  /**
   * Règle d'ensemble OmeRyth :
   * Empêche toute collision ou inversion d'ordre entre séparateurs lors du glissement.
   * Un séparateur FIN ne peut jamais dépasser ou être placé derrière le DÉBUT,
   * avec un écart minimal de sécurité (minGap = 0.08s).
   */
  clampSeparatorMove(band, currentX, desiredX, pps = 80) {
    const separators = this.bandSeparators.get(band);
    if (!separators || separators.length <= 1) {
      return desiredX;
    }

    const minGap = Math.max(2, Math.round(pps * 0.08));

    if (desiredX > currentX) {
      let nextSeparatorX = Infinity;
      for (const sep of separators) {
        if (sep.x > currentX && sep.x < nextSeparatorX) {
          nextSeparatorX = sep.x;
        }
      }
      return Math.min(desiredX, nextSeparatorX - minGap);
    } else if (desiredX < currentX) {
      let prevSeparatorX = -Infinity;
      for (const sep of separators) {
        if (sep.x < currentX && sep.x > prevSeparatorX) {
          prevSeparatorX = sep.x;
        }
      }
      return Math.max(desiredX, prevSeparatorX + minGap);
    }

    return desiredX;
  }

  moveSeparator(band, oldX, newX, pps = 80) {
    const list = this.bandSeparators.get(band);
    if (!list) return false;
    const item = list.find(m => m.x === oldX);
    if (!item) return false;

    // Application stricte de la règle de non-inversion
    const clampedX = this.clampSeparatorMove(band, oldX, Math.round(newX), pps);
    if (clampedX === item.x && oldX === clampedX) return false;

    item.x = clampedX;

    // Si c'est un START, déplacer également le TextItem lié pour garder l'alignement
    if (item.isStartBoundary()) {
      const textItem = this.texts.find(t => t.band === band && t.x === oldX);
      if (textItem) {
        textItem.x = clampedX;
      }
    }

    list.sort((a, b) => a.x - b.x);
    return true;
  }

  /**
   * Vérifie la conformité avec les règles fondamentales d'OmeRyth :
   * - Un signe FIN ne peut pas être derrière le signe DÉBUT.
   * - Un signe FIN nécessite un repère DÉBUT préalable.
   * - Pas de superposition de séparateurs.
   * - Les répliques ne peuvent pas se chevaucher.
   */
  canAddSeparator(band, x, type = SeparatorType.START) {
    const list = this.bandSeparators.get(band) || [];

    // Pas de superposition exacte
    const exist = list.find(m => Math.abs(m.x - x) <= 4);
    if (exist) {
      return { allowed: false, error: 'Un repère existe déjà à cet endroit.' };
    }

    // Règles pour repère FIN (END)
    if (type === SeparatorType.END) {
      let lastStart = null;
      for (let i = list.length - 1; i >= 0; i--) {
        const s = list[i];
        if (s.isStartBoundary() && s.x <= x) {
          lastStart = s;
          break;
        }
      }

      if (!lastStart) {
        const nextStart = list.find(s => s.isStartBoundary() && s.x > x);
        if (nextStart) {
          return { allowed: false, error: 'Règle OmeRyth : Un signe FIN ne peut pas être derrière le signe DÉBUT !' };
        }
        return { allowed: false, error: 'Impossible de poser un repère FIN : aucun repère DÉBUT préalable sur cette piste.' };
      }

      if (x <= lastStart.x) {
        return { allowed: false, error: 'Règle OmeRyth : Un signe FIN ne peut pas être derrière le signe DÉBUT !' };
      }

      // Vérifier si un repère FIN existe déjà entre ce DÉBUT et la position demandée
      const existingEnd = list.find(s => s.x > lastStart.x && s.x <= x && s.isEndBoundary());
      if (existingEnd) {
        return { allowed: false, error: 'Cette réplique possède déjà un repère FIN.' };
      }
    }

    // Règles pour repère DÉBUT (START)
    if (type === SeparatorType.START) {
      const phrase = this.findPhraseInfoAt(band, x);
      if (phrase && x > phrase.startX && x < phrase.endX) {
        return { allowed: false, error: 'Impossible de poser un DÉBUT : position à l\'intérieur d\'une réplique existante.' };
      }
    }

    // Règles pour repère INTERNE (INNER)
    if (type === SeparatorType.INNER) {
      const bounds = this.getBoundarySeparators(band, x);
      if (bounds.leftSep === null || bounds.rightSep === null || x <= bounds.leftSep || x >= bounds.rightSep) {
        return { allowed: false, error: 'Un repère interne doit être placé entre un repère DÉBUT et un repère FIN.' };
      }
    }

    return { allowed: true };
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

  // --- Mise à l'échelle temporelle (Zoom & Synchronisation PPS) ---
  scaleTimelineX(anchorX = 0, ratio = 1.0) {
    if (ratio <= 0 || Math.abs(ratio - 1.0) < 1e-6) return;

    for (const t of this.texts) {
      t.x = Math.round(anchorX + (t.x - anchorX) * ratio);
    }

    for (const seps of this.bandSeparators.values()) {
      for (const s of seps) {
        s.x = Math.round(anchorX + (s.x - anchorX) * ratio);
      }
      seps.sort((a, b) => a.x - b.x);
    }

    this.planMarkers = this.planMarkers.map(x => Math.round(anchorX + (x - anchorX) * ratio));
    this.planMarkers.sort((a, b) => a - b);

    // Mettre à l'échelle l'historique Undo / Redo
    this.scaleSnapshots(this.undoStack, anchorX, ratio);
    this.scaleSnapshots(this.redoStack, anchorX, ratio);
  }

  scaleSnapshots(stack, anchorX, ratio) {
    if (!Array.isArray(stack)) return;
    for (const s of stack) {
      if (Array.isArray(s.texts)) {
        for (const t of s.texts) {
          t.x = Math.round(anchorX + (t.x - anchorX) * ratio);
        }
      }
      if (Array.isArray(s.separators)) {
        for (const sep of s.separators) {
          sep.x = Math.round(anchorX + (sep.x - anchorX) * ratio);
        }
        s.separators.sort((a, b) => a.x - b.x);
      }
      if (Array.isArray(s.planMarkers)) {
        for (let i = 0; i < s.planMarkers.length; i++) {
          s.planMarkers[i] = Math.round(anchorX + (s.planMarkers[i] - anchorX) * ratio);
        }
        s.planMarkers.sort((a, b) => a - b);
      }
    }
  }

  // =========================================================================
  // ÉDITION DYNAMIQUE DIRECTE SUR LA BANDE (Reproduction fidèle d'OmeRyth Desktop)
  // Le texte s'étire et se met à jour en temps réel directement sur le canvas
  // =========================================================================

  /**
   * Démarre une nouvelle réplique directement sur la bande :
   * - Place le repère START
   * - Crée le TextItem vide
   * - Active le curseur clignotant sur la bande
   */
  startPhrase(band, worldX, role = null) {
    const check = this.canAddSeparator(band, worldX, SeparatorType.START);
    if (!check.allowed) {
      return { allowed: false, error: check.error };
    }

    this.recordSnapshot();
    this.addSeparator(band, worldX, SeparatorType.START, -1, 'DEFAULT', null, false);

    const activeRole = role || this.roles[0] || new Role('Narrateur', '#4ECDC4');
    const item = new TextItem('', worldX, band, activeRole);
    this.texts.push(item);

    this.isEditing = true;
    this.editingText = item;
    this.editingBand = band;
    this.cursorIndex = 0;
    this.caretVisible = true;
    this.originalEditingText = '';
    this.isNewPhraseBeingCreated = true;

    return { allowed: true, textItem: item };
  }

  /**
   * Ouvre une réplique existante en mode édition dynamique directe sur la bande.
   */
  startEditingExistingText(textItem, cursorIdx = null) {
    if (!textItem) return;
    this.recordSnapshot();
    this.isEditing = true;
    this.editingText = textItem;
    this.editingBand = textItem.band;
    this.originalEditingText = textItem.text || '';
    this.isNewPhraseBeingCreated = false;

    const len = (textItem.text || '').length;
    this.cursorIndex = cursorIdx !== null ? Math.max(0, Math.min(len, cursorIdx)) : len;
    this.caretVisible = true;
  }

  /**
   * Met à jour dynamiquement la chaîne du texte en cours d'édition
   * (appelé instantanément à chaque frappe de touche ou saisie).
   */
  setEditingTextValue(newText, newCursorIdx) {
    if (!this.isEditing || !this.editingText) return;
    this.editingText.text = newText;
    const len = (newText || '').length;
    this.cursorIndex = Math.max(0, Math.min(len, newCursorIdx !== undefined ? newCursorIdx : len));
    this.caretVisible = true;
  }

  /**
   * Calcule avec précision l'indice de caractère correspondant à un clic souris
   * sur le texte déformé élastiquement sur la bande (même algorithme qu'OmeRyth Desktop).
   */
  getCursorIndexForClick(t, mouseX, offsetX) {
    if (!t) return 0;
    const text = t.text || '';
    const len = text.length;
    if (len === 0) return 0;

    const bounds = this.getBoundarySeparators(t.band, t.x);
    const segmentStart = bounds.leftSep !== null ? bounds.leftSep : t.x;
    const segmentEnd = bounds.rightSep !== null ? bounds.rightSep : segmentStart + Math.max(100, len * 20);

    const worldX = mouseX - offsetX;
    if (worldX <= segmentStart) return 0;
    if (worldX >= segmentEnd) return len;

    const innerMarks = bounds.innerMarks;
    if (!innerMarks || innerMarks.length === 0) {
      const availWidth = Math.max(1, segmentEnd - segmentStart);
      const ratio = Math.max(0, Math.min(1, (worldX - segmentStart) / availWidth));
      return Math.min(len, Math.max(0, Math.round(ratio * len)));
    } else {
      let prevX = segmentStart;
      let prevIdx = 0;
      for (const mark of innerMarks) {
        const segStart = prevX;
        const segEnd = mark.x;
        let idx = mark.splitIndex >= 0 ? mark.splitIndex : Math.round(((mark.x - segmentStart) / Math.max(1, segmentEnd - segmentStart)) * len);
        if (idx < prevIdx) idx = prevIdx;
        if (idx > len) idx = len;

        if (worldX <= segEnd) {
          const segWidth = Math.max(1, segEnd - segStart);
          const ratio = Math.max(0, Math.min(1, (worldX - segStart) / segWidth));
          return prevIdx + Math.min(idx - prevIdx, Math.max(0, Math.round(ratio * (idx - prevIdx))));
        }
        prevX = mark.x;
        prevIdx = idx;
      }
      const segWidth = Math.max(1, segmentEnd - prevX);
      const ratio = Math.max(0, Math.min(1, (worldX - prevX) / segWidth));
      return prevIdx + Math.min(len - prevIdx, Math.max(0, Math.round(ratio * (len - prevIdx))));
    }
  }

  /**
   * Bascule le rôle de la réplique en cours d'édition vers le rôle suivant.
   */
  cycleEditingRole() {
    if (!this.isEditing || !this.editingText || this.roles.length === 0) return null;
    const curIdx = this.roles.findIndex(r => r.name.toLowerCase() === (this.editingText.role?.name || '').toLowerCase());
    const nextIdx = (curIdx + 1) % this.roles.length;
    this.editingText.role = this.roles[nextIdx];
    return this.editingText.role;
  }

  /**
   * Valide la saisie sur la bande :
   * - Si le texte est vide et qu'il s'agissait d'une nouvelle réplique, l'annule proprement.
   * - Si aucun repère de fin END n'est posé, en place un automatiquement de manière sécurisée.
   */
  commitEditing(pps = 80) {
    if (!this.isEditing || !this.editingText) return;
    const text = (this.editingText.text || '').trim();

    if (!text && this.isNewPhraseBeingCreated) {
      this.cancelEditing();
      return;
    }

    if (this.isNewPhraseBeingCreated) {
      const bounds = this.getBoundarySeparators(this.editingBand, this.editingText.x);
      if (bounds.rightSep === null) {
        const durationSec = Math.max(1.0, Math.min(6.0, text.length * 0.14));
        const desiredEnd = this.editingText.x + Math.round(durationSec * pps);

        const list = this.bandSeparators.get(this.editingBand) || [];
        const nextSep = list.find(s => s.x > this.editingText.x);
        let endX = desiredEnd;
        const minGap = Math.max(2, Math.round(pps * 0.08));

        if (nextSep) {
          endX = Math.min(desiredEnd, nextSep.x - minGap);
        }
        if (endX > this.editingText.x + minGap) {
          this.addSeparator(this.editingBand, endX, SeparatorType.END, -1, 'DEFAULT', null, false);
        }
      }
    }

    this.stopEditing();
  }

  /**
   * Annule l'édition en cours :
   * - Si c'était une nouvelle réplique non confirmée, supprime le texte et le repère START.
   * - Si c'était une réplique existante, rétablit le texte initial.
   */
  cancelEditing() {
    if (!this.isEditing || !this.editingText) return;

    if (this.isNewPhraseBeingCreated) {
      const idx = this.texts.indexOf(this.editingText);
      if (idx !== -1) {
        this.texts.splice(idx, 1);
      }
      this.removeSeparator(this.editingBand, this.editingText.x, false);
    } else {
      this.editingText.text = this.originalEditingText;
    }

    this.stopEditing();
  }

  /**
   * Quitte le mode d'édition active et masque le curseur de texte.
   */
  stopEditing() {
    this.isEditing = false;
    this.editingText = null;
    this.editingBand = -1;
    this.cursorIndex = 0;
    this.caretVisible = false;
    this.isNewPhraseBeingCreated = false;
  }
}
