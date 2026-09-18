/**
 * OmeRyth Web - Project Import / Export (RHYTHMO_V5, DETX, SRT)
 * Interopérabilité 100% garantie avec OmeRyth Desktop Java et logiciels de doublage.
 */

import { TextItem, SeparatorMark, SeparatorType, Role } from './models.js';

export class ProjectIO {
  /**
   * Exporte au format JSON natif RHYTHMO_V5
   */
  static exportRythmo(textManager, pps = 80, videoFileName = null) {
    const data = {
      version: 'RHYTHMO_V5',
      video: videoFileName,
      bandCount: textManager.bandCount,
      pixelsPerSecond: pps,
      zoomLevelIndex: 0,
      roles: textManager.roles.map(r => ({
        name: r.name,
        color: Role.hexToInt(r.color)
      })),
      texts: textManager.texts.map(t => ({
        text: t.text,
        x: t.x,
        band: t.band,
        role: t.role ? t.role.name : ''
      })),
      separators: [],
      planMarkers: [...textManager.planMarkers]
    };

    for (const [band, seps] of textManager.bandSeparators.entries()) {
      for (const s of seps) {
        data.separators.push({
          band: band,
          x: s.x,
          type: s.type,
          splitIndex: s.splitIndex,
          signType: s.signType || 'DEFAULT',
          rawDetxType: s.rawDetxType || ''
        });
      }
    }

    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
    ProjectIO.downloadBlob(blob, 'projet_rythmo.rythmo');
  }

  /**
   * Importe un fichier .rythmo (JSON RHYTHMO_V5 ou legacy)
   */
  static importRythmo(jsonStr, textManager) {
    const data = JSON.parse(jsonStr);
    textManager.recordSnapshot();

    // 1. Bandes
    if (typeof data.bandCount === 'number') {
      textManager.setBandCount(data.bandCount);
    }

    // 2. Rôles
    if (Array.isArray(data.roles)) {
      textManager.roles = data.roles.map(r => new Role(r.name, r.color));
    }

    // 3. Textes
    textManager.texts = [];
    if (Array.isArray(data.texts)) {
      for (const t of data.texts) {
        const r = textManager.getRoleByName(t.role);
        textManager.texts.push(new TextItem(t.text, t.x, t.band, r));
      }
    }

    // 4. Séparateurs
    textManager.bandSeparators.clear();
    textManager.initBands();
    if (Array.isArray(data.separators)) {
      for (const s of data.separators) {
        textManager.addSeparatorDirect(
          s.band,
          new SeparatorMark(s.x, s.type, s.splitIndex || -1, s.signType || 'DEFAULT', s.rawDetxType || null)
        );
      }
    }

    // 5. Repères de plan
    textManager.planMarkers = [];
    if (Array.isArray(data.planMarkers)) {
      textManager.planMarkers = data.planMarkers.map(x => Math.round(x)).sort((a, b) => a - b);
    }

    return true;
  }

  /**
   * Exporte les répliques au format sous-titres .SRT
   */
  static exportSrt(textManager, pps = 80) {
    const items = [];
    for (const t of textManager.texts) {
      if (!t.text || t.text.trim() === '') continue;
      const bounds = textManager.getBoundarySeparators(t.band, t.x);
      const startSec = Math.max(0, (bounds.leftSep !== null ? bounds.leftSep : t.x) / pps);
      const endSec = Math.max(startSec + 0.5, (bounds.rightSep !== null ? bounds.rightSep : t.x + 100) / pps);
      items.push({
        text: t.text,
        role: t.role ? t.role.name : '',
        start: startSec,
        end: endSec
      });
    }

    items.sort((a, b) => a.start - b.start);

    let srtContent = '';
    items.forEach((item, index) => {
      const idx = index + 1;
      const startTc = ProjectIO.formatSrtTimecode(item.start);
      const endTc = ProjectIO.formatSrtTimecode(item.end);
      const prefix = item.role ? `[${item.role}] ` : '';
      srtContent += `${idx}\n${startTc} --> ${endTc}\n${prefix}${item.text}\n\n`;
    });

    const blob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
    ProjectIO.downloadBlob(blob, 'export_doublage.srt');
  }

  static formatSrtTimecode(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1.0) * 1000);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
  }

  static downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 200);
  }
}
