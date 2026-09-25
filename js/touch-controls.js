/**
 * OmeRyth Web - Mobile & Tablet Touch Controller
 * Gestion des gestes tactiles naturels : scrub au doigt, pinch-to-zoom à deux doigts et drag de repères.
 */

export class TouchControls {
  constructor(canvas, timelineRenderer, textManager, videoSync, onUpdateCallback = null) {
    this.canvas = canvas;
    this.renderer = timelineRenderer;
    this.textManager = textManager;
    this.videoSync = videoSync;
    this.onUpdate = onUpdateCallback;
    this.onContextMenu = null;
    this.onDoubleTap = null;
    this.onTap = null;
    this.onZoom = null;

    this.isDragging = false;
    this.dragMode = 'scrub'; // 'scrub', 'separator', 'plan'
    this.dragTarget = null;
    this.dragBand = -1;

    this.touchStartX = 0;
    this.touchStartY = 0;
    this.touchStartTime = 0;
    this.hasTouchMoved = false;
    this.longPressFired = false;
    this.initialTime = 0;
    this.initialPps = 80;
    this.initialDistance = 0;
    this.lastDistance = 0;

    // Détection appui long (Context Menu sur mobile) & Double tap
    this.longPressTimer = null;
    this.lastTapTime = 0;
    this.lastTapPos = { x: 0, y: 0 };

    this.initTouchListeners();
  }

  initTouchListeners() {
    const el = this.canvas;

    el.addEventListener('touchstart', (e) => this.handleTouchStart(e), { passive: false });
    el.addEventListener('touchmove', (e) => this.handleTouchMove(e), { passive: false });
    el.addEventListener('touchend', (e) => this.handleTouchEnd(e), { passive: false });
    el.addEventListener('touchcancel', (e) => this.handleTouchEnd(e), { passive: false });
  }

  getTouchPos(touch) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: touch.clientX - rect.left,
      y: touch.clientY - rect.top
    };
  }

  handleTouchStart(e) {
    if (e.touches.length === 1) {
      e.preventDefault();
      const touch = e.touches[0];
      const pos = this.getTouchPos(touch);
      this.touchStartX = pos.x;
      this.touchStartY = pos.y;
      this.touchStartTime = performance.now();
      this.hasTouchMoved = false;
      this.longPressFired = false;
      this.initialTime = this.videoSync.currentTime;
      this.isDragging = true;

      const pps = this.videoSync.pps || 80;
      const offsetX = this.renderer.cursorX - (this.videoSync.currentTime * pps);
      const worldX = pos.x - offsetX;

      const headerH = 26;
      const bandH = this.renderer.bandHeight;
      const bandIndex = Math.floor((pos.y - headerH) / bandH);

      // Détection double-tap pour édition rapide sur écran tactile
      const now = performance.now();
      const timeDiff = now - this.lastTapTime;
      const distDiff = Math.hypot(pos.x - this.lastTapPos.x, pos.y - this.lastTapPos.y);

      if (timeDiff < 320 && distDiff < 30) {
        clearTimeout(this.longPressTimer);
        this.longPressTimer = null;
        this.isDragging = false;
        this.lastTapTime = 0;
        if (this.onDoubleTap) {
          this.onDoubleTap(worldX, bandIndex, touch.clientX, touch.clientY);
        }
        return;
      }
      this.lastTapTime = now;
      this.lastTapPos = { x: pos.x, y: pos.y };

      // Préparation de l'appui long (420ms sans mouvement = Menu Contextuel Mobile)
      clearTimeout(this.longPressTimer);
      this.longPressTimer = setTimeout(() => {
        if (this.isDragging && Math.hypot(pos.x - this.touchStartX, pos.y - this.touchStartY) < 12) {
          this.longPressFired = true;
          this.isDragging = false;
          this.dragTarget = null;
          if (navigator.vibrate) {
            try { navigator.vibrate(40); } catch (_) {}
          }
          if (this.onContextMenu) {
            this.onContextMenu({
              worldX,
              bandIdx: bandIndex,
              clientX: touch.clientX,
              clientY: touch.clientY
            });
          }
        }
      }, 420);

      // 1. Vérifier si on touche un repère de plan
      const hitPlan = this.textManager.findPlanMarkerAt(worldX, 16);
      if (hitPlan !== null) {
        this.dragMode = 'plan';
        this.dragTarget = hitPlan;
        this.textManager.recordSnapshot();
        return;
      }

      // 2. Vérifier si on touche un séparateur sur la bande
      if (bandIndex >= 0 && bandIndex < this.textManager.bandCount) {
        const hitSep = this.textManager.findSeparatorAt(bandIndex, worldX, 16);
        if (hitSep) {
          this.dragMode = 'separator';
          this.dragTarget = hitSep;
          this.dragBand = bandIndex;
          this.textManager.recordSnapshot();
          return;
        }
      }

      // 3. Par défaut : navigation / scrubbing temporel au doigt
      this.dragMode = 'scrub';
    } else if (e.touches.length === 2) {
      // Début Pinch-to-zoom à deux doigts
      e.preventDefault();
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
      this.isDragging = false;
      const p1 = this.getTouchPos(e.touches[0]);
      const p2 = this.getTouchPos(e.touches[1]);
      this.initialDistance = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      this.lastDistance = this.initialDistance;
      this.initialPps = this.videoSync.pps || 80;
    }
  }

  handleTouchMove(e) {
    if (e.touches.length === 1 && this.isDragging) {
      e.preventDefault();
      const pos = this.getTouchPos(e.touches[0]);
      const deltaX = pos.x - this.touchStartX;
      const deltaY = pos.y - this.touchStartY;

      // Annuler l'appui long et marquer le mouvement si le doigt bouge de plus de 8 pixels
      if (Math.hypot(deltaX, deltaY) > 8) {
        this.hasTouchMoved = true;
        if (this.longPressTimer) {
          clearTimeout(this.longPressTimer);
          this.longPressTimer = null;
        }
      }

      const pps = this.videoSync.pps || 80;

      if (this.dragMode === 'scrub') {
        const timeDelta = -deltaX / pps;
        this.videoSync.seekTo(this.initialTime + timeDelta);
      } else if (this.dragMode === 'plan' && this.dragTarget !== null) {
        const offsetX = this.renderer.cursorX - (this.videoSync.currentTime * pps);
        const newWorldX = Math.round((pos.x - offsetX) / (pps * 0.1)) * (pps * 0.1);
        this.textManager.movePlanMarker(this.dragTarget, newWorldX);
        this.dragTarget = Math.round(newWorldX);
      } else if (this.dragMode === 'separator' && this.dragTarget !== null) {
        const offsetX = this.renderer.cursorX - (this.videoSync.currentTime * pps);
        const newWorldX = Math.round((pos.x - offsetX) / (pps * 0.1)) * (pps * 0.1);
        this.textManager.moveSeparator(this.dragBand, this.dragTarget.x, newWorldX, pps);
      }

      if (this.onUpdate) this.onUpdate();
    } else if (e.touches.length === 2) {
      // Zoom à deux doigts fluide
      e.preventDefault();
      const p1 = this.getTouchPos(e.touches[0]);
      const p2 = this.getTouchPos(e.touches[1]);
      const currentDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);

      if (this.lastDistance > 10 && currentDist > 10) {
        const factor = currentDist / this.lastDistance;
        if (Math.abs(factor - 1.0) > 0.015) {
          if (this.onZoom) {
            this.onZoom(factor);
          }
          this.lastDistance = currentDist;
        }
      }
    }
  }

  handleTouchEnd(e) {
    clearTimeout(this.longPressTimer);
    this.longPressTimer = null;

    const elapsed = performance.now() - this.touchStartTime;
    // Détection d'un simple tap (sans glissement, durée courte, sans appui long et sans drag spécial)
    if (!this.hasTouchMoved && elapsed < 350 && !this.longPressFired && this.dragMode === 'scrub') {
      const pps = this.videoSync.pps || 80;
      const offsetX = this.renderer.cursorX - (this.videoSync.currentTime * pps);
      const worldX = this.touchStartX - offsetX;
      const headerH = 26;
      const bandH = this.renderer.bandHeight;
      const bandIndex = Math.floor((this.touchStartY - headerH) / bandH);

      if (this.onTap && bandIndex >= 0 && bandIndex < this.textManager.bandCount) {
        this.onTap({
          worldX,
          bandIdx: bandIndex,
          clientX: this.touchStartX,
          clientY: this.touchStartY
        });
      }
    }

    this.isDragging = false;
    this.dragTarget = null;
    this.dragBand = -1;
    this.dragMode = 'scrub';
    if (this.onUpdate) this.onUpdate();
  }
}
