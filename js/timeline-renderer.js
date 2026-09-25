/**
 * OmeRyth Web - Timeline Canvas 2D Renderer (60 FPS)
 * Moteur de rendu graphique haute précision reproduisant fidèlement TimelineRenderer.java.
 */

import { SeparatorType, SignType } from './models.js';

export class TimelineRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });

    this.bandHeight = 55;
    this.cursorX = 120; // Position de la barre témoin rouge en pixels depuis la gauche
    this.separatorsVisible = true;
    this.waveformVisible = true;
    this.graduationsVisible = true;
    this.activeBand = 0;

    this.dpr = window.devicePixelRatio || 1;
    this.width = 800;
    this.height = 300;

    // Polices
    this.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

    // Caches haute performance pour fluidité 60 FPS
    this._measureCache = new Map();
    this._lumaCache = new Map();
  }

  /**
   * Mesure de largeur de texte avec cache ultra-rapide O(1)
   * Évite les appels synchrones répétés à ctx.measureText() qui saturent le GPU/CPU
   */
  getTextWidth(ctx, text, font = null) {
    if (!text) return 0;
    const cacheKey = font || ctx.font || 'default';
    let fontMap = this._measureCache.get(cacheKey);
    if (!fontMap) {
      fontMap = new Map();
      this._measureCache.set(cacheKey, fontMap);
    }
    let w = fontMap.get(text);
    if (w === undefined) {
      if (fontMap.size > 2000) fontMap.clear();
      w = ctx.measureText(text).width;
      fontMap.set(text, w);
    }
    return w;
  }

  resize(width, height) {
    this.dpr = window.devicePixelRatio || 1;
    this.width = width;
    this.height = height;

    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';

    // Positionner la barre rouge témoin à ~22% sur smartphone ou 120px sur desktop
    if (width < 500) {
      this.cursorX = Math.max(50, Math.round(width * 0.22));
    } else {
      this.cursorX = 120;
    }

    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  setCursorX(x) {
    this.cursorX = Math.max(40, Math.min(x, this.width - 40));
  }

  /**
   * Rendu complet d'une frame à 60 FPS
   */
  render(textManager, currentTime, pps, waveform = null, mediaDuration = 0) {
    const ctx = this.ctx;
    const width = this.width;
    const height = this.height;
    const bandCount = textManager.bandCount;

    // Adapter dynamiquement la hauteur des bandes à la hauteur disponible
    const headerH = 26;
    const availableH = height - headerH;
    const bandH = Math.max(38, Math.floor(availableH / Math.max(1, bandCount)));
    this.bandHeight = bandH;

    const offsetX = this.cursorX - (currentTime * pps);

    // 1. Fond général du studio
    ctx.fillStyle = '#18181c';
    ctx.fillRect(0, 0, width, height);

    // 2. Bandes de doublage (pistes)
    this.drawBands(ctx, bandCount, bandH, headerH, width);

    // 3. Forme d'onde audio (si active)
    if (this.waveformVisible && waveform && waveform.hasData()) {
      waveform.draw(ctx, offsetX, width, height, pps, currentTime, headerH, bandH * bandCount);
    }

    // 4. Graduations temporelles (haut et bas)
    if (this.graduationsVisible) {
      this.drawGraduations(ctx, offsetX, width, pps, headerH, height);
    }

    // 5. Textes et répliques
    this.drawTexts(ctx, textManager, offsetX, width, pps, bandH, headerH);

    // 6. Séparateurs rythmiques (START, INNER, END)
    if (this.separatorsVisible) {
      this.drawSeparators(ctx, textManager, offsetX, width, bandH, headerH);
    }

    // 7. Repères de plan (visibles en permanence avec triangles dorés)
    this.drawPlanMarkers(ctx, textManager.planMarkers, offsetX, width, headerH, height);

    // 8. Démarcation fin de vidéo (si vidéo chargée)
    if (mediaDuration > 0) {
      this.drawVideoEndBoundary(ctx, mediaDuration, offsetX, width, pps, headerH, height);
    }

    // 9. Barre témoin de lecture (rouge)
    this.drawPlayhead(ctx, height);
  }

  drawBands(ctx, bandCount, bandH, headerH, width) {
    // 1. Fonds des bandes
    for (let b = 0; b < bandCount; b++) {
      const y = headerH + b * bandH;
      ctx.fillStyle = b % 2 === 0 ? '#1f1f24' : '#19191d';
      ctx.fillRect(0, y, width, bandH);
    }

    // 2. Lignes séparatrices groupées en un seul tracé
    ctx.strokeStyle = '#2b2b32';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let b = 0; b < bandCount; b++) {
      const lineY = headerH + (b + 1) * bandH;
      ctx.moveTo(0, lineY);
      ctx.lineTo(width, lineY);
    }
    ctx.stroke();

    // 3. Numéros de bande
    ctx.fillStyle = 'rgba(255, 255, 255, 0.20)';
    ctx.font = `600 11px ${this.fontFamily}`;
    for (let b = 0; b < bandCount; b++) {
      const y = headerH + b * bandH;
      ctx.fillText(`${b + 1}`, 10, y + bandH / 2 + 4);
    }
  }

  drawGraduations(ctx, offsetX, width, pps, headerH, totalHeight) {
    const minTime = Math.max(0, -offsetX / pps);
    const maxTime = (width - offsetX) / pps;

    // En-tête règle temporelle
    ctx.fillStyle = '#141417';
    ctx.fillRect(0, 0, width, headerH);
    ctx.strokeStyle = '#32323a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, headerH);
    ctx.lineTo(width, headerH);
    ctx.stroke();

    const startTenth = Math.floor(minTime * 10);
    const endTenth = Math.ceil(maxTime * 10);

    // Groupage des tracés pour réduire les appels GPU de 95%
    const tenthMarks = [];
    const halfMarks = [];
    const secMarks = [];
    const labels = [];

    for (let t = startTenth; t <= endTenth; t++) {
      const timeSec = t / 10;
      const screenX = timeSec * pps + offsetX;
      if (screenX < -20 || screenX > width + 20) continue;

      if (t % 10 === 0) {
        secMarks.push(screenX);
        const mins = Math.floor(timeSec / 60);
        const secs = Math.floor(timeSec % 60);
        const tc = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        labels.push({ tc, x: screenX + 4 });
      } else if (t % 5 === 0) {
        halfMarks.push(screenX);
      } else {
        tenthMarks.push(screenX);
      }
    }

    // 1. Dixièmes de seconde (1 seul stroke)
    if (tenthMarks.length > 0) {
      ctx.strokeStyle = '#444450';
      ctx.lineWidth = 0.75;
      ctx.beginPath();
      for (let i = 0; i < tenthMarks.length; i++) {
        const sx = tenthMarks[i];
        ctx.moveTo(sx, headerH - 4);
        ctx.lineTo(sx, headerH);
      }
      ctx.stroke();
    }

    // 2. Demi-secondes (1 seul stroke)
    if (halfMarks.length > 0) {
      ctx.strokeStyle = '#777785';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < halfMarks.length; i++) {
        const sx = halfMarks[i];
        ctx.moveTo(sx, headerH - 7);
        ctx.lineTo(sx, headerH);
      }
      ctx.stroke();
    }

    // 3. Secondes pleines (1 seul stroke)
    if (secMarks.length > 0) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < secMarks.length; i++) {
        const sx = secMarks[i];
        ctx.moveTo(sx, headerH - 12);
        ctx.lineTo(sx, headerH);
      }
      ctx.stroke();
    }

    // 4. Libellés timecodes (MM:SS)
    if (labels.length > 0) {
      ctx.fillStyle = '#e0e0e6';
      ctx.font = '500 11px monospace';
      for (let i = 0; i < labels.length; i++) {
        ctx.fillText(labels[i].tc, labels[i].x, headerH - 4);
      }
    }
  }

  drawTexts(ctx, textManager, offsetX, width, pps, bandH, headerH) {
    const targetTextHeight = Math.max(14, bandH - 6);
    const fontSize = Math.round(targetTextHeight * 0.9);
    ctx.font = `bold ${fontSize}px ${this.fontFamily}`;

    for (const t of textManager.texts) {
      const isCurrentlyEditing = (textManager.isEditing && textManager.editingText === t);
      const textContent = t.text || '';
      if (!isCurrentlyEditing && textContent.trim() === '') continue;

      const bandTop = headerH + t.band * bandH;
      const baselineY = bandTop + bandH - 8;

      const bounds = textManager.getBoundarySeparators(t.band, t.x);
      const segmentStart = bounds.leftSep !== null ? bounds.leftSep : t.x;
      let segmentEnd = bounds.rightSep !== null ? bounds.rightSep : segmentStart + Math.max(100, Math.max(1, textContent.length) * 20);

      // Viewport culling (ignorer si hors écran)
      const screenStart = segmentStart + offsetX;
      const screenEnd = segmentEnd + offsetX;
      if (screenEnd < -250 || screenStart > width + 250) continue;

      // 1. Badge du personnage / Rôle (affiché avant le début)
      if (t.role && t.role.name) {
        this.drawRoleBadge(ctx, t.role, screenStart, bandTop, bandH);
      }

      // Couleur de la réplique
      const color = t.role ? t.role.color : '#FFFFFF';
      ctx.fillStyle = color;

      // 2. Rendu du texte avec étirement (avec ou sans marques internes INNER)
      if (textContent.length > 0) {
        if (bounds.innerMarks.length === 0) {
          // Bloc unique étiré de segmentStart à segmentEnd
          const availWidth = Math.max(20, segmentEnd - segmentStart);
          this.drawScaledText(ctx, textContent, screenStart, baselineY, availWidth, targetTextHeight, false);
        } else {
          // Segments découpés et calés sur les séparateurs internes
          let prevX = segmentStart;
          let prevIdx = 0;
          const len = textContent.length;
          let anyDrawn = false;

          for (const mark of bounds.innerMarks) {
            const segStart = prevX;
            const segEnd = mark.x;
            if (segEnd <= segStart) continue;

            let idx = mark.splitIndex >= 0 ? mark.splitIndex : Math.round(((mark.x - segmentStart) / Math.max(1, segmentEnd - segmentStart)) * len);
            if (idx <= prevIdx || idx > len) {
              idx = Math.round(((mark.x - segmentStart) / Math.max(1, segmentEnd - segmentStart)) * len);
            }
            if (idx < prevIdx) idx = prevIdx;
            if (idx > len) idx = len;

            const sub = textContent.substring(prevIdx, idx);
            if (sub.length > 0) {
              const subScreenStart = segStart + offsetX;
              const subWidth = Math.max(10, segEnd - segStart);
              this.drawScaledText(ctx, sub, subScreenStart, baselineY, subWidth, targetTextHeight, false);
              anyDrawn = true;
            }

            prevX = mark.x;
            prevIdx = idx;
          }

          // Dernier morceau après la dernière marque interne
          const lastSub = textContent.substring(Math.min(prevIdx, len));
          if (lastSub.length > 0) {
            const lastScreenStart = prevX + offsetX;
            const lastWidth = Math.max(10, segmentEnd - prevX);
            this.drawScaledText(ctx, lastSub, lastScreenStart, baselineY, lastWidth, targetTextHeight, false);
            anyDrawn = true;
          }

          // Filet de sécurité anti-texte fantôme : si rien n'a pu être dessiné, tracer le texte entier
          if (!anyDrawn && textContent.length > 0) {
            const availWidth = Math.max(20, segmentEnd - segmentStart);
            this.drawScaledText(ctx, textContent, screenStart, baselineY, availWidth, targetTextHeight, false);
          }
        }
      }

      // 3. Curseur clignotant direct sur la bande (Caret en mode édition active)
      if (isCurrentlyEditing && textManager.caretVisible) {
        const caretX = this.computeCursorX(ctx, textContent, offsetX, segmentStart, segmentEnd, bounds.innerMarks, textManager.cursorIndex);
        const caretTop = bandTop + 3;
        const caretHeight = bandH - 6;
        ctx.save();
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = '#000000';
        ctx.shadowBlur = 3;
        ctx.fillRect(caretX - 1.5, caretTop, 3, caretHeight);
        ctx.restore();
      }
    }
  }

  computeCursorX(ctx, text, offsetX, segmentStart, segmentEnd, innerMarks, cursorIdx) {
    const len = text ? text.length : 0;
    if (len === 0 || cursorIdx <= 0) {
      return segmentStart + offsetX;
    }

    const safeCursor = Math.min(cursorIdx, len);

    if (!innerMarks || innerMarks.length === 0) {
      const availWidth = Math.max(20, segmentEnd - segmentStart);
      const totalWidth = this.getTextWidth(ctx, text);
      if (totalWidth <= 0) return segmentStart + offsetX;
      let scaleX = availWidth / totalWidth;
      scaleX = Math.max(0.05, Math.min(scaleX, 15.0));

      const sub = text.substring(0, safeCursor);
      const subWidth = this.getTextWidth(ctx, sub);
      return (segmentStart + offsetX) + (subWidth * scaleX);
    } else {
      let prevX = segmentStart;
      let prevIdx = 0;

      for (const mark of innerMarks) {
        const segStart = prevX;
        const segEnd = mark.x;
        let idx = mark.splitIndex >= 0 ? mark.splitIndex : Math.round(((mark.x - segmentStart) / Math.max(1, segmentEnd - segmentStart)) * len);
        if (idx < prevIdx) idx = prevIdx;
        if (idx > len) idx = len;

        if (safeCursor <= idx) {
          const segText = text.substring(prevIdx, idx);
          const segWidth = Math.max(10, segEnd - segStart);
          const totalWidth = this.getTextWidth(ctx, segText);
          if (totalWidth <= 0) return segStart + offsetX;
          let scaleX = segWidth / totalWidth;
          scaleX = Math.max(0.05, Math.min(scaleX, 15.0));

          const sub = text.substring(prevIdx, safeCursor);
          const subWidth = this.getTextWidth(ctx, sub);
          return (segStart + offsetX) + (subWidth * scaleX);
        }

        prevX = mark.x;
        prevIdx = idx;
      }

      // Dernier segment après la dernière marque
      const segText = text.substring(prevIdx);
      const segWidth = Math.max(10, segmentEnd - prevX);
      const totalWidth = this.getTextWidth(ctx, segText);
      if (totalWidth <= 0) return prevX + offsetX;
      let scaleX = segWidth / totalWidth;
      scaleX = Math.max(0.05, Math.min(scaleX, 15.0));

      const sub = text.substring(prevIdx, safeCursor);
      const subWidth = this.getTextWidth(ctx, sub);
      return (prevX + offsetX) + (subWidth * scaleX);
    }
  }

  drawRoleBadge(ctx, role, screenX, bandTop, bandH) {
    ctx.save();
    const badgeFont = `bold 11px ${this.fontFamily}`;
    ctx.font = badgeFont;
    const textW = this.getTextWidth(ctx, role.name, badgeFont);
    const padX = 7;
    const padY = 3;
    const bw = textW + padX * 2;
    const bh = 18;
    const bx = screenX - bw - 6;
    const by = bandTop + 4;

    // Fond arrondi du badge
    ctx.fillStyle = role.color || '#4ECDC4';
    this.roundRect(ctx, bx, by, bw, bh, 4, true, false);

    // Texte du rôle (contraste noir/blanc)
    ctx.fillStyle = this.isDark(role.color) ? '#FFFFFF' : '#000000';
    ctx.fillText(role.name, bx + padX, by + bh - 5);
    ctx.restore();
  }

  drawScaledText(ctx, text, anchorX, baselineY, targetWidth, targetHeight, anchoredRight = false) {
    if (!text || text.length === 0) return;
    const sourceWidth = this.getTextWidth(ctx, text);
    if (sourceWidth <= 0) return;

    let scaleX = targetWidth > 0 ? targetWidth / sourceWidth : 1.0;
    // Bornes de déformation identiques à OmeRyth Desktop (0.05 à 15.0)
    scaleX = Math.max(0.05, Math.min(scaleX, 15.0));

    ctx.save();
    ctx.translate(anchorX, baselineY);
    ctx.scale(scaleX, 1.0);
    const drawX = anchoredRight ? -sourceWidth : 0;
    ctx.fillText(text, drawX, 0);
    ctx.restore();
  }

  drawSeparators(ctx, textManager, offsetX, width, bandH, headerH) {
    for (const [band, seps] of textManager.bandSeparators.entries()) {
      if (!seps || seps.length === 0) continue;
      const bandTop = headerH + band * bandH;
      const bandMid = bandTop + bandH / 2;

      for (const mark of seps) {
        const sx = mark.x + offsetX;
        if (sx < -40 || sx > width + 40) continue;

        switch (mark.type) {
          case SeparatorType.START: {
            // Ligne verticale verte très visible marquant le début exact (▶ Début)
            ctx.strokeStyle = '#50dc78';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(sx, bandTop + 2);
            ctx.lineTo(sx, bandTop + bandH - 2);
            ctx.stroke();

            // Onglet supérieur (▶ Début)
            const triW = Math.max(10, Math.min(14, bandH * 0.25));
            const triH = Math.max(8, Math.min(12, bandH * 0.22));
            ctx.fillStyle = '#50dc78';
            ctx.beginPath();
            ctx.moveTo(sx, bandTop + 2);
            ctx.lineTo(sx + triW, bandTop + 2);
            ctx.lineTo(sx, bandTop + 2 + triH);
            ctx.closePath();
            ctx.fill();

            // Triangle inférieur contrasté
            ctx.beginPath();
            ctx.moveTo(sx, bandTop + bandH - 2);
            ctx.lineTo(sx, bandTop + bandH - 2 - triH);
            ctx.lineTo(sx + triW, bandTop + bandH - 2);
            ctx.closePath();
            ctx.fill();
            break;
          }

          case SeparatorType.END: {
            // Ligne verticale rouge éclatante marquant la fin exacte (◀ Fin de réplique)
            ctx.strokeStyle = '#ff3c3c';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(sx, bandTop + 2);
            ctx.lineTo(sx, bandTop + bandH - 2);
            ctx.stroke();

            // Onglet supérieur (◀ Fin)
            const triW = Math.max(10, Math.min(14, bandH * 0.25));
            const triH = Math.max(8, Math.min(12, bandH * 0.22));
            ctx.fillStyle = '#ff3c3c';
            ctx.beginPath();
            ctx.moveTo(sx, bandTop + 2);
            ctx.lineTo(sx - triW, bandTop + 2);
            ctx.lineTo(sx, bandTop + 2 + triH);
            ctx.closePath();
            ctx.fill();

            // Triangle inférieur contrasté
            ctx.beginPath();
            ctx.moveTo(sx, bandTop + bandH - 2);
            ctx.lineTo(sx, bandTop + bandH - 2 - triH);
            ctx.lineTo(sx - triW, bandTop + bandH - 2);
            ctx.closePath();
            ctx.fill();
            break;
          }

          case SeparatorType.INNER: {
            // Ligne verticale interne avec pastille centrale
            const signMeta = SignType[mark.signType] || SignType.DEFAULT;
            const sepCol = signMeta.color || '#ffc832';

            ctx.strokeStyle = sepCol;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(sx, bandTop + 2);
            ctx.lineTo(sx, bandTop + bandH - 2);
            ctx.stroke();

            // Pastille centrale
            const dotR = 4.5;
            ctx.fillStyle = sepCol;
            ctx.beginPath();
            ctx.arc(sx, bandMid, dotR, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#18181c';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            // Badge lipsync si présent (F, M, A, N, h/)
            if (signMeta.badge) {
              ctx.save();
              ctx.font = `bold 10px ${this.fontFamily}`;
              const bw = 14;
              const bh = 14;
              const bx = sx - bw / 2;
              const by = bandTop + 2;

              ctx.fillStyle = 'rgba(20, 20, 25, 0.85)';
              this.roundRect(ctx, bx, by, bw, bh, 3, true, false);
              ctx.fillStyle = sepCol;
              ctx.textAlign = 'center';
              ctx.fillText(signMeta.badge, sx, by + bh - 3);
              ctx.restore();
            }
            break;
          }
        }
      }
    }
  }

  drawPlanMarkers(ctx, planMarkers, offsetX, width, headerH, totalHeight) {
    if (!planMarkers || planMarkers.length === 0) return;

    for (const markerX of planMarkers) {
      const sx = markerX + offsetX;
      if (sx < -20 || sx > width + 20) continue;

      // Ombre portée contrastée
      ctx.strokeStyle = 'rgba(10, 10, 15, 0.7)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(sx, headerH);
      ctx.lineTo(sx, totalHeight);
      ctx.stroke();

      // Ligne principale blanche lumineuse
      ctx.strokeStyle = 'rgba(245, 245, 255, 0.95)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx, headerH);
      ctx.lineTo(sx, totalHeight);
      ctx.stroke();

      // Triangles dorés de coupe (haut et bas)
      const tagSize = 7;
      ctx.fillStyle = '#facc15'; // Jaune or vif
      ctx.strokeStyle = '#785500';
      ctx.lineWidth = 1;

      // Triangle haut
      ctx.beginPath();
      ctx.moveTo(sx - tagSize, headerH);
      ctx.lineTo(sx + tagSize, headerH);
      ctx.lineTo(sx, headerH + tagSize * 1.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Triangle bas
      ctx.beginPath();
      ctx.moveTo(sx - tagSize, totalHeight);
      ctx.lineTo(sx + tagSize, totalHeight);
      ctx.lineTo(sx, totalHeight - tagSize * 1.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  drawPlayhead(ctx, height) {
    const sx = this.cursorX;

    // Ombre rouge diffuse
    ctx.strokeStyle = 'rgba(230, 57, 70, 0.35)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, height);
    ctx.stroke();

    // Ligne centrale rouge vif
    ctx.strokeStyle = '#e63946';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, height);
    ctx.stroke();

    // Curseur flèche rouge en haut
    ctx.fillStyle = '#e63946';
    ctx.beginPath();
    ctx.moveTo(sx - 7, 0);
    ctx.lineTo(sx + 7, 0);
    ctx.lineTo(sx, 11);
    ctx.closePath();
    ctx.fill();
  }

  roundRect(ctx, x, y, width, height, radius = 5, fill = true, stroke = false) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    if (fill) ctx.fill();
    if (stroke) ctx.stroke();
  }

  isDark(hexColor) {
    if (!hexColor || !hexColor.startsWith('#')) return false;
    let cached = this._lumaCache.get(hexColor);
    if (cached !== undefined) return cached;

    const clean = hexColor.replace('#', '');
    const r = parseInt(clean.substring(0, 2), 16) || 0;
    const g = parseInt(clean.substring(2, 4), 16) || 0;
    const b = parseInt(clean.substring(4, 6), 16) || 0;
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    const isDarkRes = luma < 120;
    this._lumaCache.set(hexColor, isDarkRes);
    return isDarkRes;
  }

  drawVideoEndBoundary(ctx, mediaDuration, offsetX, width, pps, headerH, height) {
    const endX = mediaDuration * pps + offsetX;
    if (endX < width) {
      const startDrawX = Math.max(0, endX);
      // Zone assombrie indiquant l'après-vidéo
      ctx.fillStyle = 'rgba(10, 10, 14, 0.70)';
      ctx.fillRect(startDrawX, headerH, width - startDrawX, height - headerH);

      // Ligne verticale rouge distinctive marquant la fin exacte
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(endX, 0);
      ctx.lineTo(endX, height);
      ctx.stroke();

      // Badge rouge "FIN VIDÉO"
      ctx.fillStyle = 'rgba(239, 68, 68, 0.9)';
      const badgeFont = `bold 10px ${this.fontFamily}`;
      ctx.font = badgeFont;
      const badgeText = 'FIN VIDÉO';
      const textW = this.getTextWidth(ctx, badgeText, badgeFont);
      ctx.fillRect(endX + 4, headerH + 6, textW + 8, 16);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(badgeText, endX + 8, headerH + 18);
    }
  }
}
