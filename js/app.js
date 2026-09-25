/**
 * OmeRyth Web - Main Application Controller
 * Initialisation, liaison des événements UI, gestion des modales et boucle d'affichage 60 FPS.
 */

import { TextManager } from './text-manager.js';
import { TimelineRenderer } from './timeline-renderer.js';
import { VideoSync } from './video-sync.js';
import { AudioWaveform } from './audio-waveform.js';
import { TouchControls } from './touch-controls.js';
import { ShortcutsManager } from './shortcuts.js';
import { ProjectIO } from './project-io.js';
import { TextItem, SeparatorType, Role } from './models.js';
import { VideoFpsDetector } from './video-fps-detector.js';
import { StorageManager } from './storage-manager.js';

export class OmeRythApp {
  constructor() {
    this.pps = 80.0; // Pixels par seconde
    this.activeBand = 0;
    this.selectedItem = null;
    this.selectedSeparator = null;
    this.selectedPlanMarker = null;
    this.contextTarget = null;
    this.currentMediaFile = null;
    this.currentMediaObjectUrl = null;
    this.isCreatingNewProject = false;
    this.transcribeTaskId = null;
    this.transcribeInterval = null;
    this.autoSaveTimer = null;

    // Instances principales
    this.textManager = new TextManager(4);
    this.waveform = new AudioWaveform();

    this.canvas = document.getElementById('timelineCanvas');
    this.videoEl = document.getElementById('videoPlayer');
    this.videoPlaceholder = document.getElementById('videoPlaceholder');

    this.renderer = new TimelineRenderer(this.canvas);
    this.videoSync = new VideoSync(this.videoEl, (time) => this.onTimeUpdate(time));
    this.videoSync.pps = this.pps;
    this.videoSync.onPlayStateChange = (playing) => {
      this.updatePlayButton(playing);
      if (!playing) this.scheduleAutoSave();
    };

    if (this.videoEl) {
      this.videoEl.addEventListener('error', (e) => this.handleVideoError(e));
    }

    this.touchControls = new TouchControls(this.canvas, this.renderer, this.textManager, this.videoSync, () => {
      this.render();
      this.scheduleAutoSave();
    });
    this.touchControls.onContextMenu = (info) => this.openContextMenuAt(info.worldX, info.bandIdx, info.clientX, info.clientY);
    this.touchControls.onDoubleTap = (worldX, bandIdx) => this.handleDoubleTap(worldX, bandIdx);
    this.touchControls.onTap = (info) => this.handleTap(info.worldX, info.bandIdx);
    this.touchControls.onZoom = (factor) => this.setPps(this.pps * factor, true);

    this.shortcuts = new ShortcutsManager(this);

    // Initialisation automatique du mode de saisie selon l'appareil détecté (PC direct / Mobile modale)
    this.inputMode = this.detectInputMode();
    this.inlineEditing = null;

    this.initUI();
    this.initLiveBandEditor();
    this.initCanvasMouseEvents();
    this.initContextMenu();
    this.initMobileDrawer();
    this.initTranscribeModal();
    this.initVideoPromptModal();
    this.initResizeHandler();
    this.updateFpsBadge();

    // Initialisation des cookies, du stockage local et restauration de session
    this.initCookieAndStorage();
    this.startupSession();
  }

  initUI() {
    // --- Barre de transport ---
    const btnPlay = document.getElementById('btnPlay');
    if (btnPlay) {
      btnPlay.addEventListener('click', () => this.togglePlayPause());
    }

    const btnToggleFps = document.getElementById('btnToggleFps');
    if (btnToggleFps) {
      btnToggleFps.addEventListener('click', () => {
        const nextFps = (Math.round(this.videoSync.fps) === 24) ? 60 : 24;
        this.videoSync.setFps(nextFps);
        this.updateFpsBadge();
        this.render();
        this.showToast(`Cadence d'images : ${Math.round(this.videoSync.fps)} IPS`);
      });
    }

    // Saut 0.1s arrière (Flèche Gauche)
    const btnStepPrev = document.getElementById('btnStepPrev');
    if (btnStepPrev) {
      btnStepPrev.addEventListener('click', () => {
        this.videoSync.seekDelta(-0.1);
        this.render();
      });
    }

    // Saut 0.1s avant (Flèche Droite)
    const btnStepNext = document.getElementById('btnStepNext');
    if (btnStepNext) {
      btnStepNext.addEventListener('click', () => {
        this.videoSync.seekDelta(0.1);
        this.render();
      });
    }

    const btnPrev = document.getElementById('btnPrev');
    if (btnPrev) {
      btnPrev.addEventListener('click', () => {
        this.videoSync.seekDelta(-0.5);
        this.render();
      });
    }

    const btnNext = document.getElementById('btnNext');
    if (btnNext) {
      btnNext.addEventListener('click', () => {
        this.videoSync.seekDelta(0.5);
        this.render();
      });
    }

    const btnFramePrev = document.getElementById('btnFramePrev');
    if (btnFramePrev) {
      btnFramePrev.addEventListener('click', () => {
        this.videoSync.stepFrame(-1);
        this.render();
      });
    }

    const btnFrameNext = document.getElementById('btnFrameNext');
    if (btnFrameNext) {
      btnFrameNext.addEventListener('click', () => {
        this.videoSync.stepFrame(1);
        this.render();
      });
    }

    const selectSpeed = document.getElementById('selectSpeed');
    if (selectSpeed) {
      selectSpeed.addEventListener('change', (e) => {
        this.videoSync.setRate(parseFloat(e.target.value));
      });
    }

    const sliderVolume = document.getElementById('sliderVolume');
    if (sliderVolume) {
      sliderVolume.addEventListener('input', (e) => {
        this.videoSync.setVolume(parseInt(e.target.value, 10));
      });
    }

    // --- Actions Timeline & Pistes ---
    document.getElementById('btnAddBand')?.addEventListener('click', () => {
      this.textManager.setBandCount(this.textManager.bandCount + 1);
      this.render();
      this.showToast(`Bande ajoutée (${this.textManager.bandCount} bandes)`);
    });

    document.getElementById('btnRemoveBand')?.addEventListener('click', () => {
      if (this.textManager.bandCount > 1) {
        this.textManager.setBandCount(this.textManager.bandCount - 1);
        this.render();
        this.showToast(`Bande retirée (${this.textManager.bandCount} bandes)`);
      }
    });

    document.getElementById('btnZoomIn')?.addEventListener('click', () => {
      this.setPps(this.pps * 1.25, true);
    });

    document.getElementById('btnZoomOut')?.addEventListener('click', () => {
      this.setPps(this.pps * 0.8, true);
    });

    document.getElementById('btnWaveform')?.addEventListener('click', () => this.toggleWaveform());

    document.getElementById('btnSigns')?.addEventListener('click', () => {
      this.renderer.separatorsVisible = !this.renderer.separatorsVisible;
      this.render();
      this.showToast(this.renderer.separatorsVisible ? 'Signes affichés' : 'Signes masqués');
    });

    // --- Gestion de Projet (Nouveau, Ouvrir, Sauvegarder, Démo) ---
    document.getElementById('btnNew')?.addEventListener('click', () => {
      this.promptNewProject();
    });

    document.getElementById('btnMobileNew')?.addEventListener('click', () => {
      this.promptNewProject();
    });

    document.getElementById('btnSave')?.addEventListener('click', () => this.exportProject());

    const fileInputProject = document.getElementById('fileInputProject');
    document.getElementById('btnOpen')?.addEventListener('click', () => {
      fileInputProject?.click();
    });

    fileInputProject?.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      if (files.length === 0) return;

      const projectFile = files.find(f => f.name.toLowerCase().endsWith('.rythmo') || f.name.toLowerCase().endsWith('.json'));
      const mediaFile = files.find(f => f.type.startsWith('video/') || f.type.startsWith('audio/') || f.name.toLowerCase().endsWith('.mkv'));

      if (projectFile) {
        try {
          const text = await projectFile.text();
          const meta = ProjectIO.importRythmo(text, this.textManager);

          if (meta && typeof meta.pixelsPerSecond === 'number' && meta.pixelsPerSecond > 0) {
            this.setPps(meta.pixelsPerSecond, false);
          } else {
            this.setPps(80.0, false);
          }
          this.render();

          if (mediaFile) {
            this.isCreatingNewProject = false;
            await this.loadMediaFile(mediaFile, false);
            this.showToast(`Projet "${projectFile.name}" et vidéo "${mediaFile.name}" chargés !`);
          } else {
            const expectedVideo = meta ? meta.video : null;
            this.updatePlaceholderForProject(projectFile.name, expectedVideo);
            this.isCreatingNewProject = false;
            this.openVideoPromptModal(projectFile.name, expectedVideo);
          }
        } catch (err) {
          alert('Erreur lors du chargement du fichier .rythmo : ' + err.message);
        }
      } else if (mediaFile) {
        await this.loadMediaFile(mediaFile, false);
      }
      e.target.value = '';
    });

    // --- Sélecteur de média masqué ---
    const fileInputMedia = document.getElementById('fileInputMedia');
    fileInputMedia?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (file) {
        const resetProject = this.isCreatingNewProject === true;
        await this.loadMediaFile(file, resetProject);
        this.isCreatingNewProject = false;
      }
      e.target.value = '';
    });

    // Bouton Rôles
    document.getElementById('btnRoles')?.addEventListener('click', () => this.openRolesModal());

    // Bouton Aide
    document.getElementById('btnHelp')?.addEventListener('click', () => {
      document.getElementById('helpModal').classList.add('active');
    });

    // Boutons de la barre mobile supérieure
    document.getElementById('btnMobileSave')?.addEventListener('click', () => {
      this.exportProject();
    });

    document.getElementById('btnMobileMenu')?.addEventListener('click', () => {
      document.getElementById('mobileDrawerBackdrop')?.classList.add('active');
    });

    // --- Mobile Dubbing Pad (Boutons tactiles pour smartphones) ---
    document.querySelectorAll('.dub-pad-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        this.vibrate(30);
        const action = btn.dataset.action;
        if (action === 'start') this.addSeparatorAtCursor('START');
        else if (action === 'end') this.addSeparatorAtCursor('END');
        else if (action === 'inner') this.addSeparatorAtCursor('INNER');
        else if (action === 'plan') this.addPlanMarkerAtCursor();
        else if (action === 'fvr') this.addSignAtCursor('FVR');
        else if (action === 'mpb') this.addSignAtCursor('MPB');
        else if (action === 'open_a') this.addSignAtCursor('OPEN_A');
        else if (action === 'neutral') this.addSignAtCursor('NEUTRAL');
      });
    });

    // Fermeture des modales
    document.querySelectorAll('.modal-close, .modal-backdrop').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target === el) {
          if (el.closest('#textModal') || el.id === 'textModal') {
            document.getElementById('btnCancelTextModal')?.click();
            return;
          }
          document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
        }
      });
    });

    // Drag & Drop sur toute la fenêtre
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', async (e) => {
      e.preventDefault();
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const files = Array.from(e.dataTransfer.files);
        const projectFile = files.find(f => f.name.toLowerCase().endsWith('.rythmo') || f.name.toLowerCase().endsWith('.json'));
        const mediaFile = files.find(f => f.type.startsWith('video/') || f.type.startsWith('audio/') || f.name.toLowerCase().endsWith('.mkv'));

        if (projectFile) {
          try {
            const text = await projectFile.text();
            const meta = ProjectIO.importRythmo(text, this.textManager);
            if (meta && typeof meta.pixelsPerSecond === 'number' && meta.pixelsPerSecond > 0) {
              this.setPps(meta.pixelsPerSecond, false);
            } else {
              this.setPps(80.0, false);
            }
            this.render();

            if (mediaFile) {
              this.isCreatingNewProject = false;
              await this.loadMediaFile(mediaFile, false);
              this.showToast(`Projet "${projectFile.name}" et média "${mediaFile.name}" importés !`);
            } else {
              const expectedVideo = meta ? meta.video : null;
              this.updatePlaceholderForProject(projectFile.name, expectedVideo);
              this.isCreatingNewProject = false;
              this.openVideoPromptModal(projectFile.name, expectedVideo);
            }
          } catch (err) {
            alert('Erreur lors du chargement du fichier .rythmo : ' + err.message);
          }
        } else if (mediaFile) {
          const reset = this.textManager.texts.length === 0;
          await this.loadMediaFile(mediaFile, reset);
        }
      }
    });
  }

  async loadMediaFile(file, resetTextManager = true) {
    this.currentMediaFile = file;
    this.updateTranscribeMediaCard();
    this.showToast(`Chargement de "${file.name}"...`);

    // Fermer la modale de demande vidéo si elle était active
    document.getElementById('videoPromptModal')?.classList.remove('active');

    // Nettoyer l'ancienne URL d'objet pour éviter les fuites de mémoire
    if (this.currentMediaObjectUrl) {
      URL.revokeObjectURL(this.currentMediaObjectUrl);
      this.currentMediaObjectUrl = null;
    }

    const objectUrl = URL.createObjectURL(file);
    this.currentMediaObjectUrl = objectUrl;
    this.videoSync.loadSource(objectUrl);

    // Détection automatique du framerate : 24 IPS si ~24 (cinéma/23.976/24), sinon 60 IPS
    try {
      const targetFps = await VideoFpsDetector.detectTargetFps(file, this.videoEl);
      this.videoSync.setFps(targetFps);
      this.updateFpsBadge();
      console.log(`[VideoSync] FPS configuré à : ${targetFps} IPS`);
    } catch (e) {
      console.warn('[VideoSync] Repli sur 60 IPS :', e);
      this.videoSync.setFps(60);
      this.updateFpsBadge();
    }

    // Gestion propre des fichiers audio purs (sans flux vidéo)
    const isAudioOnly = (file.type && file.type.startsWith('audio/')) ||
      (!file.type && /\.(mp3|wav|ogg|aac|flac|m4a)$/i.test(file.name));

    if (this.videoPlaceholder) {
      if (isAudioOnly) {
        this.videoPlaceholder.style.display = 'flex';
        this.videoPlaceholder.innerHTML = `
          <div class="icon">🎵</div>
          <p><strong>${file.name}</strong></p>
          <p style="font-size: 12px; color: var(--accent-gold);">Fichier audio chargé (${Math.round(this.videoSync.fps)} IPS)</p>
        `;
        this.videoEl.style.display = 'none';
      } else {
        this.videoPlaceholder.style.display = 'none';
        this.videoEl.style.display = 'block';
      }
    } else {
      this.videoEl.style.display = isAudioOnly ? 'none' : 'block';
    }

    if (resetTextManager) {
      this.textManager = new TextManager(4);
      if (this.touchControls) {
        this.touchControls.textManager = this.textManager;
      }
      this.setPps(80.0, false);
    }
    this.render();
    this.scheduleAutoSave();

    // Extraction et décodage de la forme d'onde via Web Audio API
    this.waveform.loadFromBlob(file, (pct, msg) => {
      if (pct === 100) {
        this.showToast('Waveform audio calculée avec succès !');
        this.render();
      }
    });
  }

  initCanvasMouseEvents() {
    let isMouseDown = false;
    let dragMode = null; // 'separator', 'plan', 'scrub'
    let dragTarget = null;
    let dragBand = -1;
    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let clickedTextCandidate = null;
    let hasMovedSinceDown = false;

    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return; // Uniquement clic gauche
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const headerH = 26;
      const bandH = this.renderer.bandHeight;
      const offsetX = this.renderer.cursorX - (this.videoSync.currentTime * this.pps);
      const worldX = mouseX - offsetX;

      startX = mouseX;
      startY = mouseY;
      startTime = this.videoSync.currentTime;
      isMouseDown = true;
      hasMovedSinceDown = false;
      clickedTextCandidate = null;

      // 1. Clic sur la règle temporelle (en-tête) -> Navigation temporelle
      if (mouseY <= headerH) {
        dragMode = 'scrub';
        const targetTime = Math.max(0, (mouseX - this.renderer.cursorX) / this.pps + this.videoSync.currentTime);
        this.videoSync.seekTo(targetTime);
        this.render();
        return;
      }

      // 2. Clic sur un repère de plan
      const hitPlan = this.textManager.findPlanMarkerAt(worldX, 10);
      if (hitPlan !== null) {
        dragMode = 'plan';
        dragTarget = hitPlan;
        this.selectedPlanMarker = hitPlan;
        this.textManager.recordSnapshot();
        return;
      }

      // 3. Déterminer la bande sélectionnée
      const bandIdx = Math.floor((mouseY - headerH) / bandH);
      if (bandIdx >= 0 && bandIdx < this.textManager.bandCount) {
        this.activeBand = bandIdx;

        // Vérifier si clic sur un séparateur
        const hitSep = this.textManager.findSeparatorAt(bandIdx, worldX, 10);
        if (hitSep) {
          dragMode = 'separator';
          dragTarget = hitSep;
          dragBand = bandIdx;
          this.selectedSeparator = hitSep;
          this.textManager.recordSnapshot();
          return;
        }

        // Vérifier si clic sur un texte (candidat pour édition au simple clic)
        const hitText = this.textManager.findTextAt(bandIdx, worldX, this.pps);
        this.selectedItem = hitText;
        if (hitText) {
          clickedTextCandidate = hitText;
        }
      }

      // Par défaut : scrubbing
      dragMode = 'scrub';
    });

    window.addEventListener('mousemove', (e) => {
      if (!isMouseDown) return;
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const deltaX = mouseX - startX;
      const deltaY = mouseY - startY;

      if (Math.hypot(deltaX, deltaY) > 5) {
        hasMovedSinceDown = true;
      }

      if (dragMode === 'scrub') {
        const timeDelta = -deltaX / this.pps;
        this.videoSync.seekTo(startTime + timeDelta);
      } else if (dragMode === 'plan' && dragTarget !== null) {
        const offsetX = this.renderer.cursorX - (this.videoSync.currentTime * this.pps);
        const newWorldX = this.snapWorldXToTenth(mouseX - offsetX);
        this.textManager.movePlanMarker(dragTarget, newWorldX);
        dragTarget = Math.round(newWorldX);
        this.render();
      } else if (dragMode === 'separator' && dragTarget !== null) {
        const offsetX = this.renderer.cursorX - (this.videoSync.currentTime * this.pps);
        const newWorldX = this.snapWorldXToTenth(mouseX - offsetX);
        this.textManager.moveSeparator(dragBand, dragTarget.x, newWorldX, this.pps);
        this.render();
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (isMouseDown && !hasMovedSinceDown && clickedTextCandidate && dragMode === 'scrub') {
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const offsetX = this.renderer.cursorX - (this.videoSync.currentTime * this.pps);
        if (this.inputMode === 'pc') {
          const clickedIdx = this.textManager.getCursorIndexForClick(clickedTextCandidate, mouseX, offsetX);
          this.startBandTextEditing(clickedTextCandidate, clickedIdx);
        } else {
          this.openTextEditModal(clickedTextCandidate);
        }
      } else if (isMouseDown && !hasMovedSinceDown && this.textManager.isEditing) {
        // Clic sur le texte en cours d'édition pour déplacer le curseur, ou clic ailleurs pour valider
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const offsetX = this.renderer.cursorX - (this.videoSync.currentTime * this.pps);
        const cur = this.textManager.editingText;
        if (cur) {
          const bounds = this.textManager.getBoundarySeparators(cur.band, cur.x);
          const segStart = bounds.leftSep !== null ? bounds.leftSep : cur.x;
          const segEnd = bounds.rightSep !== null ? bounds.rightSep : segStart + 200;
          const worldX = mouseX - offsetX;
          if (worldX >= segStart - 10 && worldX <= segEnd + 10) {
            const clickedIdx = this.textManager.getCursorIndexForClick(cur, mouseX, offsetX);
            this.textManager.cursorIndex = clickedIdx;
            this.textManager.caretVisible = true;
            const capturer = document.getElementById('canvasKeyboardCapturer');
            if (capturer) {
              capturer.setSelectionRange(clickedIdx, clickedIdx);
              capturer.focus({ preventScroll: true });
            }
            this.render();
          } else {
            this.commitBandTextEditing();
          }
        }
      }
      if (hasMovedSinceDown && (dragMode === 'plan' || dragMode === 'separator')) {
        this.scheduleAutoSave();
      }
      isMouseDown = false;
      dragMode = null;
      dragTarget = null;
      dragBand = -1;
      clickedTextCandidate = null;
      hasMovedSinceDown = false;
    });

    // Double-clic : Ajout ou édition de texte
    this.canvas.addEventListener('dblclick', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const headerH = 26;
      const bandH = this.renderer.bandHeight;
      const bandIdx = Math.floor((mouseY - headerH) / bandH);

      if (bandIdx >= 0 && bandIdx < this.textManager.bandCount) {
        const offsetX = this.renderer.cursorX - (this.videoSync.currentTime * this.pps);
        const worldX = mouseX - offsetX;
        const existingText = this.textManager.findTextAt(bandIdx, worldX, this.pps);

        if (existingText) {
          if (this.inputMode === 'pc') {
            const clickedIdx = this.textManager.getCursorIndexForClick(existingText, mouseX, offsetX);
            this.startBandTextEditing(existingText, clickedIdx);
          } else {
            this.openTextEditModal(existingText);
          }
        } else {
          if (this.inputMode === 'pc') {
            this.startNewPhraseOnBand(bandIdx, worldX);
          } else {
            this.openNewTextModal(bandIdx, worldX);
          }
        }
      }
    });

    // Clic droit : Menu contextuel fluide
    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const offsetX = this.renderer.cursorX - (this.videoSync.currentTime * this.pps);
      const worldX = mouseX - offsetX;
      const headerH = 26;
      const bandH = this.renderer.bandHeight;
      const bandIdx = Math.floor((mouseY - headerH) / bandH);

      this.openContextMenuAt(worldX, bandIdx, e.clientX, e.clientY);
    });

    // Fermeture du menu contextuel au clic ailleurs
    window.addEventListener('click', (e) => {
      if (!e.target.closest('#contextMenu')) {
        this.hideContextMenu();
      }
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.hideContextMenu();
        document.getElementById('mobileDrawerBackdrop')?.classList.remove('active');
      }
    });

    // Molette souris : Zoom ou Défilement
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        // Zoom
        const factor = e.deltaY < 0 ? 1.15 : 0.87;
        this.setPps(this.pps * factor, true);
      } else {
        // Défilement temporel
        const deltaSec = (e.deltaY / 100) * 0.5;
        this.videoSync.seekDelta(deltaSec);
        this.render();
      }
    }, { passive: false });
  }

  initResizeHandler() {
    const handleResize = () => {
      // Détection automatique du mode (PC direct / Mobile modale)
      this.inputMode = this.detectInputMode();

      const container = this.canvas.parentElement;
      if (container) {
        const rect = container.getBoundingClientRect();
        const w = Math.round(rect.width) || container.clientWidth || 320;
        const h = Math.round(rect.height) || container.clientHeight || 160;
        if (w > 0 && h > 0) {
          this.renderer.resize(w, h);
          this.render();
        }
      }
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', () => {
      setTimeout(handleResize, 80);
      setTimeout(handleResize, 250);
    });

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleResize);
    }

    if (window.ResizeObserver && this.canvas.parentElement) {
      const ro = new ResizeObserver(() => {
        handleResize();
      });
      ro.observe(this.canvas.parentElement);
    }

    setTimeout(handleResize, 50);
  }

  onTimeUpdate(currentTime) {
    if (!this.tcDisplay) {
      this.tcDisplay = document.getElementById('timecodeDisplay');
    }
    if (this.tcDisplay) {
      this.tcDisplay.textContent = this.videoSync.formatTimecode(currentTime);
    }
    this.render();
  }

  render() {
    this.renderer.render(
      this.textManager,
      this.videoSync.currentTime,
      this.pps,
      this.waveform,
      this.videoSync.mediaDuration || 0
    );
  }

  togglePlayPause() {
    this.videoSync.togglePlayPause();
  }

  updatePlayButton(isPlaying) {
    const btnPlay = document.getElementById('btnPlay');
    if (btnPlay) {
      btnPlay.innerHTML = isPlaying 
        ? '<span class="play-icon">⏸</span><span class="play-text"> Pause</span>' 
        : '<span class="play-icon">▶</span><span class="play-text"> Lecture</span>';
      btnPlay.classList.toggle('playing', !!isPlaying);
    }
  }

  toggleWaveform() {
    this.renderer.waveformVisible = !this.renderer.waveformVisible;
    this.render();
    this.showToast(this.renderer.waveformVisible ? 'Waveform affichée' : 'Waveform masquée');
  }

  addSeparatorAtCursor(type = 'START') {
    const currentWorldX = this.snapWorldXToTenth(this.videoSync.currentTime * this.pps);
    const bandIdx = this.activeBand;

    // Règle d'ensemble OmeRyth : validation stricte avant ajout
    const check = this.textManager.canAddSeparator(bandIdx, currentWorldX, type);
    if (!check.allowed) {
      this.showToast('⚠️ ' + check.error);
      this.vibrate([40, 40]);
      return;
    }

    if (type === 'START' || type === SeparatorType.START) {
      if (this.inputMode === 'pc') {
        this.startNewPhraseOnBand(bandIdx, currentWorldX);
      } else {
        this.textManager.addSeparator(bandIdx, currentWorldX, SeparatorType.START);
        this.render();
        this.openPromptForStart(bandIdx, currentWorldX);
      }
      return;
    }

    if (type === 'END' || type === SeparatorType.END) {
      // Si une édition est active sur cette piste, commit avec cette fin
      if (this.textManager.isEditing && this.textManager.editingBand === bandIdx) {
        this.textManager.addSeparator(bandIdx, currentWorldX, SeparatorType.END);
        this.commitBandTextEditing();
        return;
      }
      this.textManager.addSeparator(bandIdx, currentWorldX, SeparatorType.END);
      this.render();
      this.scheduleAutoSave();
      this.showToast(`Repère FIN posé à ${this.videoSync.currentTime.toFixed(2)}s`);
      return;
    }

    if (type === 'INNER' || type === SeparatorType.INNER) {
      this.textManager.addSeparator(bandIdx, currentWorldX, SeparatorType.INNER);
      this.render();
      this.scheduleAutoSave();
      this.showToast(`Séparateur interne posé sur la piste ${bandIdx + 1}`);
      return;
    }
  }

  addSignAtCursor(signTypeId) {
    const currentWorldX = this.snapWorldXToTenth(this.videoSync.currentTime * this.pps);
    const bandIdx = this.activeBand;

    // Règle OmeRyth : un signe lipsync doit être placé à l'intérieur d'une réplique
    const check = this.textManager.canAddSeparator(bandIdx, currentWorldX, SeparatorType.INNER);
    if (!check.allowed) {
      this.showToast(`⚠️ Le signe ${signTypeId} doit être placé à l'intérieur d'une réplique.`);
      this.vibrate([30, 30]);
      return;
    }

    this.textManager.addSeparator(bandIdx, currentWorldX, SeparatorType.INNER, -1, signTypeId);
    this.render();
    this.scheduleAutoSave();
    this.showToast(`Signe ${signTypeId} posé sur la piste ${bandIdx + 1}`);
  }

  addPlanMarkerAtCursor() {
    const currentWorldX = this.snapWorldXToTenth(this.videoSync.currentTime * this.pps);
    this.textManager.addPlanMarker(currentWorldX);
    this.render();
    this.scheduleAutoSave();
    this.showToast(`Repère de plan posé à ${this.videoSync.currentTime.toFixed(2)}s`);
  }

  undo() {
    if (this.textManager.undo()) {
      this.render();
      this.scheduleAutoSave();
      this.showToast('Annuler (Undo)');
    }
  }

  redo() {
    if (this.textManager.redo()) {
      this.render();
      this.scheduleAutoSave();
      this.showToast('Rétablir (Redo)');
    }
  }

  deleteSelection() {
    if (this.selectedItem) {
      this.textManager.removeTextItem(this.selectedItem);
      this.selectedItem = null;
      this.render();
      this.scheduleAutoSave();
      this.showToast('Réplique supprimée');
    }
  }

  exportProject() {
    ProjectIO.exportRythmo(this.textManager, this.pps, this.currentMediaFile?.name || null);
    this.showToast('Projet .rythmo téléchargé !');
  }

  setPps(newPps, scaleContent = true) {
    newPps = Math.max(30, Math.min(240, newPps));
    const oldPps = this.pps;
    if (Math.abs(newPps - oldPps) < 1e-4) return;

    this.pps = newPps;
    this.videoSync.pps = newPps;

    if (scaleContent && oldPps > 0) {
      const ratio = newPps / oldPps;
      this.textManager.scaleTimelineX(0, ratio);
    }
    this.render();
    this.scheduleAutoSave();
  }

  promptNewProject() {
    if (this.textManager.texts.length > 0) {
      if (!confirm('Créer un nouveau projet vierge ? Les répliques et modifications non enregistrées seront perdues.')) {
        return;
      }
    }
    this.textManager = new TextManager(4);
    if (this.touchControls) {
      this.touchControls.textManager = this.textManager;
    }
    this.setPps(80.0, false);
    this.render();
    this.scheduleAutoSave();
    this.isCreatingNewProject = true;
    document.getElementById('fileInputMedia')?.click();
  }

  updatePlaceholderForProject(projectName, expectedVideo = null) {
    if (!this.videoPlaceholder) return;
    const pText = document.getElementById('placeholderText');
    const btnAction = document.getElementById('btnPlaceholderAction');
    if (pText) {
      if (expectedVideo) {
        pText.innerHTML = `Projet <strong>${projectName}</strong> chargé.<br>Vidéo attendue : <strong>${expectedVideo}</strong>`;
      } else {
        pText.innerHTML = `Projet <strong>${projectName}</strong> chargé.<br>Sélectionnez la vidéo correspondante :`;
      }
    }
    if (btnAction) {
      btnAction.textContent = expectedVideo ? `🎬 Choisir "${expectedVideo}"` : '🎬 Associer la vidéo';
    }
    this.videoPlaceholder.style.display = 'flex';
    this.videoEl.style.display = 'none';
  }

  // =========================================================================
  // ÉDITION DYNAMIQUE DIRECTE SUR LA BANDE (MODE PC) & GESTION DES MODES
  // Reproduction fidèle d'OmeRyth Desktop : saisie directement sur le canvas
  // =========================================================================

  initLiveBandEditor() {
    const capturer = document.getElementById('canvasKeyboardCapturer');
    if (!capturer) return;

    capturer.addEventListener('input', () => {
      if (!this.textManager.isEditing) return;
      this.textManager.setEditingTextValue(capturer.value, capturer.selectionStart);
      this.render();
    });

    capturer.addEventListener('keydown', (e) => {
      if (!this.textManager.isEditing) return;

      if (e.key === 'Enter') {
        e.preventDefault();
        this.commitBandTextEditing();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.cancelBandTextEditing();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        const role = this.textManager.cycleEditingRole();
        this.render();
        if (role) this.showToast(`Personnage : ${role.name}`);
      }
    });

    const syncSelection = () => {
      if (this.textManager.isEditing) {
        this.textManager.cursorIndex = capturer.selectionStart;
        this.textManager.caretVisible = true;
        this.render();
      }
    };

    capturer.addEventListener('keyup', syncSelection);
    capturer.addEventListener('click', syncSelection);
    capturer.addEventListener('select', syncSelection);

    // Clignotement fluide du curseur (caret) sur la bande (500ms)
    setInterval(() => {
      if (this.textManager.isEditing) {
        this.textManager.caretVisible = !this.textManager.caretVisible;
        this.render();
      }
    }, 500);

    // Clic en dehors du canvas pour valider l'édition en cours
    window.addEventListener('mousedown', (e) => {
      if (!this.textManager.isEditing) return;
      if (e.target === this.canvas) return;
      if (e.target.closest('#textModal')) return;
      this.commitBandTextEditing();
    });
  }

  startBandTextEditing(textItem, cursorIdx = null) {
    if (this.videoSync && this.videoSync.isPlaying) {
      this.videoSync.pause();
    }
    this.activeBand = textItem.band;
    this.textManager.startEditingExistingText(textItem, cursorIdx);
    const capturer = document.getElementById('canvasKeyboardCapturer');
    if (capturer) {
      capturer.value = textItem.text || '';
      const pos = this.textManager.cursorIndex;
      capturer.setSelectionRange(pos, pos);
      capturer.focus({ preventScroll: true });
    }
    this.render();
  }

  startNewPhraseOnBand(bandIdx, worldX) {
    if (this.videoSync && this.videoSync.isPlaying) {
      this.videoSync.pause();
    }
    this.activeBand = bandIdx;
    const defaultRole = this.textManager.roles[bandIdx % this.textManager.roles.length] || this.textManager.roles[0];
    const res = this.textManager.startPhrase(bandIdx, worldX, defaultRole);
    if (!res.allowed) {
      this.showToast('⚠️ ' + res.error);
      this.vibrate([40, 40]);
      return;
    }
    const capturer = document.getElementById('canvasKeyboardCapturer');
    if (capturer) {
      capturer.value = '';
      capturer.setSelectionRange(0, 0);
      capturer.focus({ preventScroll: true });
    }
    this.render();
    this.showToast('✍️ Saisie directe sur la bande (Entrée pour valider, Tab pour changer de rôle)');
  }

  commitBandTextEditing() {
    if (!this.textManager.isEditing) return;
    const item = this.textManager.editingText;
    this.textManager.commitEditing(this.pps);
    const capturer = document.getElementById('canvasKeyboardCapturer');
    if (capturer) capturer.blur();
    this.render();
    this.scheduleAutoSave();
    if (item && (item.text || '').trim()) {
      this.showToast(`Réplique enregistrée pour ${item.role?.name || 'Personnage'}`);
    }
  }

  cancelBandTextEditing() {
    if (!this.textManager.isEditing) return;
    this.textManager.cancelEditing();
    const capturer = document.getElementById('canvasKeyboardCapturer');
    if (capturer) capturer.blur();
    this.render();
    this.showToast('Saisie annulée');
  }

  detectInputMode() {
    const ua = navigator.userAgent || '';
    const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isSmallScreen = window.innerWidth <= 768;
    const isTouchOnly = ('ontouchstart' in window || navigator.maxTouchPoints > 0) &&
      !window.matchMedia('(pointer: fine)').matches;

    return (isMobileUA || isSmallScreen || isTouchOnly) ? 'mobile' : 'pc';
  }

  ensurePhraseStartSeparator(bandIdx, startX) {
    if (!this.textManager.bandSeparators.has(bandIdx)) {
      this.textManager.bandSeparators.set(bandIdx, []);
    }
    const list = this.textManager.bandSeparators.get(bandIdx);
    const existingStart = list.find(s => Math.abs(s.x - startX) <= 6 && s.isStartBoundary());
    if (!existingStart) {
      this.textManager.addSeparator(bandIdx, startX, SeparatorType.START, -1, 'DEFAULT', null, false);
    }
  }

  ensurePhraseEndSeparator(bandIdx, startX, textContent) {
    const pps = this.pps || 80;
    const text = (textContent || '').trim();
    // Rythme naturel de parole (environ 12 à 15 caractères par seconde)
    const charDur = Math.max(1, text.length) * 0.08;
    const estSec = Math.max(1.3, Math.min(3.8, charDur));

    // Largeur visible sur le canvas à droite du curseur
    const canvasW = this.renderer?.width || 360;
    const curX = this.renderer?.cursorX || 80;
    const maxVisiblePx = Math.max(90, canvasW - curX - 25);

    // Distance désirée en pixels, bornée pour rester immédiatement visible sur smartphone
    const pxDur = Math.min(Math.round(estSec * pps), maxVisiblePx);
    const desiredEndX = this.snapWorldXToTenth(startX + pxDur);

    if (!this.textManager.bandSeparators.has(bandIdx)) {
      this.textManager.bandSeparators.set(bandIdx, []);
    }
    const list = this.textManager.bandSeparators.get(bandIdx);
    list.sort((a, b) => a.x - b.x);

    // Trouver le prochain START éventuel après startX
    const nextStart = list.find(s => s.x > startX + 4 && s.isStartBoundary());

    // Vérifier si un repère END existe DÉJÀ spécifiquement pour CETTE réplique
    // (doit être après startX, avant le prochain START s'il y en a un, et dans la portée de la phrase)
    const maxPhraseSpan = nextStart ? (nextStart.x - startX) : Math.max(desiredEndX - startX + 80, Math.round(5.0 * pps));
    const existingEnd = list.find(s => 
      s.x > startX + 4 && 
      s.isEndBoundary() && 
      (!nextStart || s.x < nextStart.x) &&
      (s.x - startX <= maxPhraseSpan)
    );

    if (!existingEnd) {
      let endX = desiredEndX;
      const minGap = Math.max(4, Math.round(pps * 0.08));

      if (nextStart && nextStart.x <= endX) {
        endX = Math.max(startX + minGap, nextStart.x - minGap);
      }
      if (endX <= startX) {
        endX = startX + Math.round(1.0 * pps);
      }

      this.textManager.addSeparator(bandIdx, endX, SeparatorType.END, -1, 'DEFAULT', null, false);
      return endX;
    }
    return existingEnd.x;
  }

  openPromptForStart(bandIdx, worldX) {
    // Si un texte existe déjà sous ce repère, on passe en mode modification
    const existing = this.textManager.findTextAt(bandIdx, worldX, this.pps);
    if (existing) {
      if (this.inputMode === 'pc') {
        this.startBandTextEditing(existing);
      } else {
        this.openTextEditModal(existing);
      }
      return;
    }

    if (this.inputMode === 'pc') {
      this.startNewPhraseOnBand(bandIdx, worldX);
      return;
    }

    const textModal = document.getElementById('textModal');
    const input = document.getElementById('modalTextInput');
    const roleSelect = document.getElementById('modalRoleSelect');
    const roleBadge = document.getElementById('modalRoleBadge');
    const title = document.getElementById('textModalTitle');
    const btnSave = document.getElementById('btnSaveTextModal');
    const btnCancel = document.getElementById('btnCancelTextModal');
    const btnClose = document.getElementById('btnCloseTextModal');

    // Pause de la vidéo pendant la saisie pour calage parfait
    if (this.videoSync && this.videoSync.isPlaying) {
      this.videoSync.pause();
    }

    title.textContent = `Nouvelle réplique - Repère START (Bande ${bandIdx + 1})`;
    input.value = '';

    // Définir le rôle par défaut selon la bande active
    const defaultRole = this.textManager.roles[bandIdx % this.textManager.roles.length] || this.textManager.roles[0];

    // Peupler la liste déroulante des rôles
    roleSelect.innerHTML = '';
    this.textManager.roles.forEach(r => {
      const opt = document.createElement('option');
      opt.value = r.name;
      opt.textContent = r.name;
      if (defaultRole && defaultRole.name === r.name) {
        opt.selected = true;
      }
      roleSelect.appendChild(opt);
    });

    const updateBadge = () => {
      const selected = this.textManager.getRoleByName(roleSelect.value);
      if (roleBadge && selected) {
        roleBadge.style.backgroundColor = selected.color || '#4ECDC4';
      }
    };
    updateBadge();

    // Création d'un TextItem temporaire pour affichage dynamique immédiat sur le canvas
    let liveItem = new TextItem('', worldX, bandIdx, defaultRole);
    this.textManager.addTextItem(liveItem, false);

    // Modification DYNAMIQUE en temps réel pendant la frappe
    input.oninput = () => {
      liveItem.text = input.value;
      this.render();
    };

    roleSelect.onchange = () => {
      liveItem.role = this.textManager.getRoleByName(roleSelect.value);
      updateBadge();
      this.render();
    };

    const cleanup = () => {
      input.oninput = null;
      roleSelect.onchange = null;
      input.onkeydown = null;
      if (btnSave) btnSave.onclick = null;
      if (btnCancel) btnCancel.onclick = null;
      if (btnClose) btnClose.onclick = null;
      textModal.classList.remove('active');
    };

    const onSave = () => {
      const trimmed = input.value.trim();
      const finalText = trimmed || '...';
      liveItem.text = finalText;
      liveItem.role = this.textManager.getRoleByName(roleSelect.value);

      // Toujours garantir les repères START (▶) et END (◀) pour cette réplique sur mobile
      this.ensurePhraseStartSeparator(bandIdx, worldX);
      this.ensurePhraseEndSeparator(bandIdx, worldX, finalText);

      this.textManager.recordSnapshot();
      this.render();
      this.scheduleAutoSave();
      this.showToast(`Réplique enregistrée pour ${liveItem.role?.name || 'Personnage'}`);
      cleanup();
    };

    const onCancel = () => {
      this.textManager.removeTextItem(liveItem, false);
      this.render();
      this.showToast('Repère START posé');
      cleanup();
    };

    if (btnSave) {
      btnSave.onclick = (e) => {
        if (e) e.preventDefault();
        onSave();
      };
    }
    if (btnCancel) {
      btnCancel.onclick = (e) => {
        if (e) e.preventDefault();
        onCancel();
      };
    }
    if (btnClose) {
      btnClose.onclick = (e) => {
        if (e) e.preventDefault();
        onCancel();
      };
    }

    input.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onSave();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };

    textModal.classList.add('active');
    setTimeout(() => {
      input.focus();
    }, 50);
  }

  openNewTextModal(bandIdx, worldX) {
    const snappedX = this.snapWorldXToTenth(worldX);
    const check = this.textManager.canAddSeparator(bandIdx, snappedX, SeparatorType.START);
    if (!check.allowed) {
      this.showToast('⚠️ ' + check.error);
      this.vibrate([30, 30]);
      return;
    }
    this.textManager.addSeparator(bandIdx, snappedX, SeparatorType.START);
    this.render();
    if (this.inputMode === 'pc') {
      this.startInlineBandEditing(bandIdx, snappedX, null);
    } else {
      this.openPromptForStart(bandIdx, snappedX);
    }
  }

  openTextEditModal(textItem) {
    if (!textItem) return;

    if (this.inputMode === 'pc') {
      this.startInlineBandEditing(textItem.band, textItem.x, textItem);
      return;
    }

    const textModal = document.getElementById('textModal');
    const input = document.getElementById('modalTextInput');
    const roleSelect = document.getElementById('modalRoleSelect');
    const roleBadge = document.getElementById('modalRoleBadge');
    const title = document.getElementById('textModalTitle');
    const btnSave = document.getElementById('btnSaveTextModal');
    const btnCancel = document.getElementById('btnCancelTextModal');
    const btnClose = document.getElementById('btnCloseTextModal');

    if (this.videoSync && this.videoSync.isPlaying) {
      this.videoSync.pause();
    }

    title.textContent = `Modifier la réplique (Bande ${textItem.band + 1})`;
    input.value = textItem.text || '';

    // Mémoriser l'état d'origine en cas d'annulation
    const originalText = textItem.text;
    const originalRole = textItem.role;

    // Peupler la liste des rôles
    roleSelect.innerHTML = '';
    this.textManager.roles.forEach(r => {
      const opt = document.createElement('option');
      opt.value = r.name;
      opt.textContent = r.name;
      if (textItem.role && textItem.role.name === r.name) {
        opt.selected = true;
      }
      roleSelect.appendChild(opt);
    });

    const updateBadge = () => {
      const selected = this.textManager.getRoleByName(roleSelect.value);
      if (roleBadge && selected) {
        roleBadge.style.backgroundColor = selected.color || '#4ECDC4';
      }
    };
    updateBadge();

    // Modification DYNAMIQUE en temps réel sur la timeline
    input.oninput = () => {
      textItem.text = input.value;
      this.render();
    };

    roleSelect.onchange = () => {
      textItem.role = this.textManager.getRoleByName(roleSelect.value);
      updateBadge();
      this.render();
    };

    const cleanup = () => {
      input.oninput = null;
      roleSelect.onchange = null;
      input.onkeydown = null;
      if (btnSave) btnSave.onclick = null;
      if (btnCancel) btnCancel.onclick = null;
      if (btnClose) btnClose.onclick = null;
      textModal.classList.remove('active');
    };

    const onSave = () => {
      const trimmed = input.value.trim();
      if (trimmed) {
        textItem.text = trimmed;
        textItem.role = this.textManager.getRoleByName(roleSelect.value);

        // Toujours garantir le repère START (▶) et le repère END (◀) pour cette réplique
        this.ensurePhraseStartSeparator(textItem.band, textItem.x);
        this.ensurePhraseEndSeparator(textItem.band, textItem.x, trimmed);

        this.textManager.recordSnapshot();
        this.render();
        this.scheduleAutoSave();
        this.showToast('Réplique enregistrée !');
      } else {
        if (confirm('Le texte est vide. Souhaitez-vous supprimer cette réplique ?')) {
          this.textManager.removeTextItem(textItem);
          this.render();
          this.scheduleAutoSave();
          this.showToast('Réplique supprimée');
        } else {
          textItem.text = originalText;
          textItem.role = originalRole;
          this.render();
        }
      }
      cleanup();
    };

    const onCancel = () => {
      textItem.text = originalText;
      textItem.role = originalRole;
      this.render();
      cleanup();
    };

    if (btnSave) {
      btnSave.onclick = (e) => {
        if (e) e.preventDefault();
        onSave();
      };
    }
    if (btnCancel) {
      btnCancel.onclick = (e) => {
        if (e) e.preventDefault();
        onCancel();
      };
    }
    if (btnClose) {
      btnClose.onclick = (e) => {
        if (e) e.preventDefault();
        onCancel();
      };
    }

    input.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onSave();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };

    textModal.classList.add('active');
    setTimeout(() => {
      input.focus();
      input.select();
    }, 50);
  }

  openRolesModal() {
    const modal = document.getElementById('rolesModal');
    const list = document.getElementById('rolesList');
    list.innerHTML = '';

    this.textManager.roles.forEach((r, idx) => {
      const row = document.createElement('div');
      row.className = 'role-row';
      row.innerHTML = `
        <input type="color" value="${r.color}" class="role-color-input" data-idx="${idx}">
        <input type="text" value="${r.name}" class="role-name-input" data-idx="${idx}">
        <button class="btn btn-sm btn-danger role-del-btn" data-idx="${idx}">🗑️</button>
      `;
      list.appendChild(row);
    });

    // Événements modification couleurs & noms
    list.querySelectorAll('.role-color-input').forEach(input => {
      input.addEventListener('change', (e) => {
        const idx = parseInt(e.target.dataset.idx, 10);
        this.textManager.roles[idx].color = e.target.value;
        this.render();
      });
    });

    list.querySelectorAll('.role-name-input').forEach(input => {
      input.addEventListener('change', (e) => {
        const idx = parseInt(e.target.dataset.idx, 10);
        this.textManager.roles[idx].name = e.target.value;
        this.render();
      });
    });

    list.querySelectorAll('.role-del-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.target.dataset.idx, 10);
        if (this.textManager.roles.length > 1) {
          this.textManager.roles.splice(idx, 1);
          this.openRolesModal();
          this.render();
        }
      });
    });

    document.getElementById('btnAddRole')?.addEventListener('click', () => {
      const newRole = new Role(`Personnage ${this.textManager.roles.length + 1}`, '#06D6A0');
      this.textManager.addRole(newRole);
      this.openRolesModal();
      this.render();
    });

    modal.classList.add('active');
  }

  showToast(message, duration = 2200) {
    const toast = document.getElementById('toast');
    if (toast) {
      toast.textContent = message;
      toast.classList.add('show');
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => {
        toast.classList.remove('show');
      }, duration);
    }
  }

  vibrate(ms = 25) {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate(ms); } catch (_) {}
    }
  }

  handleTap(worldX, bandIdx) {
    if (bandIdx < 0 || bandIdx >= this.textManager.bandCount) return;
    this.activeBand = bandIdx;
    const existingText = this.textManager.findTextAt(bandIdx, worldX, this.pps);
    if (existingText) {
      this.openTextEditModal(existingText);
    }
  }

  handleDoubleTap(worldX, bandIdx) {
    if (bandIdx < 0 || bandIdx >= this.textManager.bandCount) return;
    this.activeBand = bandIdx;
    const existingText = this.textManager.findTextAt(bandIdx, worldX, this.pps);
    if (existingText) {
      this.openTextEditModal(existingText);
    } else {
      this.openNewTextModal(bandIdx, worldX);
    }
  }

  initContextMenu() {
    document.getElementById('cmenuDeletePhrase')?.addEventListener('click', () => {
      if (this.contextTarget) {
        const band = this.contextTarget.bandIdx;
        const startX = this.contextTarget.phraseStartX;
        this.textManager.deletePhraseAtStart(band, startX);
        this.render();
        this.scheduleAutoSave();
        this.vibrate(40);
        this.showToast('Réplique et repères supprimés');
      }
      this.hideContextMenu();
    });

    document.getElementById('cmenuEditText')?.addEventListener('click', () => {
      const targetText = this.contextTarget?.hitText || this.contextTarget?.phraseInfo?.textItem;
      if (targetText) {
        if (this.inputMode === 'pc') {
          this.startBandTextEditing(targetText);
        } else {
          this.openTextEditModal(targetText);
        }
      }
      this.hideContextMenu();
    });

    document.getElementById('cmenuDeleteSep')?.addEventListener('click', () => {
      if (this.contextTarget?.hitSep) {
        const sep = this.contextTarget.hitSep;
        const band = this.contextTarget.bandIdx;
        if (sep.isStartBoundary()) {
          // Si on supprime le signe de début, cela supprime la phrase
          this.textManager.deletePhraseAtStart(band, sep.x);
          this.render();
          this.scheduleAutoSave();
          this.vibrate(40);
          this.showToast('Réplique et repères supprimés');
        } else {
          this.textManager.removeSeparator(band, sep.x);
          this.render();
          this.scheduleAutoSave();
          this.vibrate(25);
          this.showToast('Séparateur supprimé');
        }
      }
      this.hideContextMenu();
    });

    document.getElementById('cmenuDeletePlan')?.addEventListener('click', () => {
      if (this.contextTarget?.hitPlan !== null && this.contextTarget?.hitPlan !== undefined) {
        this.textManager.removePlanMarker(this.contextTarget.hitPlan);
        this.render();
        this.scheduleAutoSave();
        this.vibrate(25);
        this.showToast('Repère de plan supprimé');
      }
      this.hideContextMenu();
    });

    document.getElementById('cmenuAddStart')?.addEventListener('click', () => {
      if (this.contextTarget && this.contextTarget.bandIdx >= 0) {
        const curX = this.snapWorldXToTenth(this.contextTarget.worldX);
        const bandIdx = this.contextTarget.bandIdx;
        const check = this.textManager.canAddSeparator(bandIdx, curX, SeparatorType.START);
        if (!check.allowed) {
          this.showToast('⚠️ ' + check.error);
          this.vibrate([30, 30]);
          this.hideContextMenu();
          return;
        }
        if (this.inputMode === 'pc') {
          this.startNewPhraseOnBand(bandIdx, curX);
        } else {
          this.textManager.addSeparator(bandIdx, curX, SeparatorType.START);
          this.render();
          this.vibrate(25);
          this.openPromptForStart(bandIdx, curX);
        }
      }
      this.hideContextMenu();
    });

    document.getElementById('cmenuAddEnd')?.addEventListener('click', () => {
      if (this.contextTarget && this.contextTarget.bandIdx >= 0) {
        const curX = this.snapWorldXToTenth(this.contextTarget.worldX);
        const bandIdx = this.contextTarget.bandIdx;
        const check = this.textManager.canAddSeparator(bandIdx, curX, SeparatorType.END);
        if (!check.allowed) {
          this.showToast('⚠️ ' + check.error);
          this.vibrate([40, 40]);
          this.hideContextMenu();
          return;
        }
        if (this.textManager.isEditing && this.textManager.editingBand === bandIdx) {
          this.textManager.addSeparator(bandIdx, curX, SeparatorType.END);
          this.commitBandTextEditing();
          this.hideContextMenu();
          return;
        }
        this.textManager.addSeparator(bandIdx, curX, SeparatorType.END);
        this.render();
        this.scheduleAutoSave();
        this.vibrate(25);
        this.showToast('Repère Fin (END) posé');
      }
      this.hideContextMenu();
    });

    document.getElementById('cmenuAddInner')?.addEventListener('click', () => {
      if (this.contextTarget && this.contextTarget.bandIdx >= 0) {
        const curX = this.snapWorldXToTenth(this.contextTarget.worldX);
        const bandIdx = this.contextTarget.bandIdx;
        const check = this.textManager.canAddSeparator(bandIdx, curX, SeparatorType.INNER);
        if (!check.allowed) {
          this.showToast('⚠️ ' + check.error);
          this.vibrate([30, 30]);
          this.hideContextMenu();
          return;
        }
        this.textManager.addSeparator(bandIdx, curX, SeparatorType.INNER);
        this.render();
        this.scheduleAutoSave();
        this.vibrate(25);
        this.showToast('Séparateur interne posé');
      }
      this.hideContextMenu();
    });

    document.getElementById('cmenuAddPlan')?.addEventListener('click', () => {
      if (this.contextTarget) {
        const curX = Math.round(this.contextTarget.worldX / (this.pps * 0.1)) * (this.pps * 0.1);
        this.textManager.addPlanMarker(curX);
        this.render();
        this.scheduleAutoSave();
        this.vibrate(25);
        this.showToast('Repère de plan posé');
      }
      this.hideContextMenu();
    });
  }

  openContextMenuAt(worldX, bandIdx, clientX, clientY) {
    const validBand = (bandIdx >= 0 && bandIdx < this.textManager.bandCount);
    const hitPlan = this.textManager.findPlanMarkerAt(worldX, 14);
    const hitSep = validBand ? this.textManager.findSeparatorAt(bandIdx, worldX, 16) : null;
    const hitText = validBand ? this.textManager.findTextAt(bandIdx, worldX, this.pps) : null;
    const phraseInfo = validBand ? this.textManager.findPhraseInfoAt(bandIdx, worldX) : null;

    const cmenu = document.getElementById('contextMenu');
    const header = document.getElementById('cmenuHeader');
    const itemDelPhrase = document.getElementById('cmenuDeletePhrase');
    const itemEditText = document.getElementById('cmenuEditText');
    const itemDelSep = document.getElementById('cmenuDeleteSep');
    const itemDelPlan = document.getElementById('cmenuDeletePlan');
    const itemDivider = document.getElementById('cmenuDivider');
    const itemAddStart = document.getElementById('cmenuAddStart');
    const itemAddEnd = document.getElementById('cmenuAddEnd');
    const itemAddInner = document.getElementById('cmenuAddInner');
    const itemAddPlan = document.getElementById('cmenuAddPlan');

    if (!cmenu) return;

    const startX = hitSep?.isStartBoundary() ? hitSep.x : (phraseInfo?.startX ?? (hitText ? hitText.x : worldX));

    this.contextTarget = {
      worldX,
      bandIdx,
      hitPlan,
      hitSep,
      hitText,
      phraseInfo,
      phraseStartX: startX
    };

    let hasTarget = false;

    if (hitPlan !== null) {
      hasTarget = true;
      header.textContent = `Repère de Plan (${(hitPlan / this.pps).toFixed(2)}s)`;
      itemDelPlan.style.display = 'flex';
      itemDelPhrase.style.display = 'none';
      itemEditText.style.display = 'none';
      itemDelSep.style.display = 'none';
    } else if (hitSep) {
      hasTarget = true;
      const isStart = hitSep.isStartBoundary();
      header.textContent = isStart ? `Repère Début (Bande ${bandIdx + 1})` : `Repère ${hitSep.type} (Bande ${bandIdx + 1})`;

      if (isStart) {
        // Clic droit sur signe de début : suppression de la phrase entière
        itemDelPhrase.style.display = 'flex';
        itemDelSep.style.display = 'flex';
        itemDelSep.querySelector('.cmenu-text').textContent = "Supprimer uniquement ce repère";
        itemEditText.style.display = (hitText || phraseInfo?.textItem) ? 'flex' : 'none';
      } else {
        itemDelPhrase.style.display = 'none';
        itemDelSep.style.display = 'flex';
        itemDelSep.querySelector('.cmenu-text').textContent = "Supprimer ce repère";
        itemEditText.style.display = 'none';
      }
      itemDelPlan.style.display = 'none';
    } else if (hitText) {
      hasTarget = true;
      header.textContent = `Réplique (Bande ${bandIdx + 1})`;
      itemDelPhrase.style.display = 'flex';
      itemEditText.style.display = 'flex';
      itemDelSep.style.display = 'none';
      itemDelPlan.style.display = 'none';
    } else {
      header.textContent = validBand ? `Bande ${bandIdx + 1}` : 'Timeline';
      itemDelPhrase.style.display = 'none';
      itemEditText.style.display = 'none';
      itemDelSep.style.display = 'none';
      itemDelPlan.style.display = 'none';
    }

    itemDivider.style.display = hasTarget ? 'none' : 'block';
    itemAddStart.style.display = (!hasTarget && validBand) ? 'flex' : 'none';
    itemAddEnd.style.display = (!hasTarget && validBand) ? 'flex' : 'none';
    itemAddInner.style.display = (!hasTarget && validBand) ? 'flex' : 'none';
    itemAddPlan.style.display = !hasTarget ? 'flex' : 'none';

    cmenu.style.display = 'block';
    const rect = cmenu.getBoundingClientRect();
    const posX = Math.max(10, Math.min(clientX, window.innerWidth - rect.width - 12));
    const posY = Math.max(10, Math.min(clientY, window.innerHeight - rect.height - 12));
    cmenu.style.left = `${posX}px`;
    cmenu.style.top = `${posY}px`;
  }

  hideContextMenu() {
    const cmenu = document.getElementById('contextMenu');
    if (cmenu) cmenu.style.display = 'none';
    this.contextTarget = null;
  }

  initMobileDrawer() {
    const backdrop = document.getElementById('mobileDrawerBackdrop');
    const closeBtn = document.getElementById('btnCloseMobileDrawer');

    const closeDrawer = () => {
      backdrop?.classList.remove('active');
    };

    closeBtn?.addEventListener('click', closeDrawer);
    backdrop?.addEventListener('click', (e) => {
      if (e.target === backdrop) closeDrawer();
    });

    const fileInputProject = document.getElementById('fileInputProject');
    const fileInputMedia = document.getElementById('fileInputMedia');

    document.getElementById('mBtnNew')?.addEventListener('click', () => {
      closeDrawer();
      this.promptNewProject();
    });

    document.getElementById('mBtnOpen')?.addEventListener('click', () => {
      closeDrawer();
      fileInputProject?.click();
    });

    document.getElementById('mBtnSave')?.addEventListener('click', () => {
      closeDrawer();
      this.exportProject();
    });

    document.getElementById('mBtnRoles')?.addEventListener('click', () => {
      closeDrawer();
      this.openRolesModal();
    });

    document.getElementById('mBtnAddBand')?.addEventListener('click', () => {
      this.textManager.setBandCount(this.textManager.bandCount + 1);
      this.render();
      this.showToast(`Bande ajoutée (${this.textManager.bandCount})`);
    });

    document.getElementById('mBtnRemoveBand')?.addEventListener('click', () => {
      if (this.textManager.bandCount > 1) {
        this.textManager.setBandCount(this.textManager.bandCount - 1);
        this.render();
        this.showToast(`Bande retirée (${this.textManager.bandCount})`);
      }
    });

    document.getElementById('mBtnWaveform')?.addEventListener('click', () => {
      this.toggleWaveform();
    });

    document.getElementById('mBtnSigns')?.addEventListener('click', () => {
      this.renderer.separatorsVisible = !this.renderer.separatorsVisible;
      this.render();
      this.showToast(this.renderer.separatorsVisible ? 'Signes affichés' : 'Signes masqués');
    });

    document.getElementById('mBtnZoomIn')?.addEventListener('click', () => {
      this.setPps(this.pps * 1.25, true);
    });

    document.getElementById('mBtnZoomOut')?.addEventListener('click', () => {
      this.setPps(this.pps * 0.8, true);
    });

    document.getElementById('mBtnHelp')?.addEventListener('click', () => {
      closeDrawer();
      document.getElementById('helpModal')?.classList.add('active');
    });
  }

  // =========================================================================
  // GESTION DES COOKIES, DU CONSENTEMENT ET DE LA PERSISTANCE (INDEXEDDB)
  // =========================================================================

  initCookieAndStorage() {
    const banner = document.getElementById('cookieBanner');
    const btnAccept = document.getElementById('btnCookieAccept');
    const btnDecline = document.getElementById('btnCookieDecline');
    const btnCookiesDesktop = document.getElementById('btnCookies');
    const btnCookiesMobile = document.getElementById('mBtnCookies');

    const showBanner = () => {
      if (banner) {
        banner.style.display = 'block';
      }
    };

    const hideBanner = () => {
      if (banner) {
        banner.style.display = 'none';
      }
    };

    btnAccept?.addEventListener('click', async () => {
      StorageManager.setConsentStatus('accepted');
      hideBanner();
      await this.saveCurrentSession();
      this.showToast('🍪 Cookies acceptés : votre bande et votre vidéo seront mémorisées !', 3200);
    });

    btnDecline?.addEventListener('click', async () => {
      StorageManager.setConsentStatus('declined');
      hideBanner();
      await StorageManager.clearSession();
      this.showToast('🍪 Cookies refusés : aucune donnée ne sera sauvegardée.', 3000);
    });

    btnCookiesDesktop?.addEventListener('click', () => {
      showBanner();
    });

    btnCookiesMobile?.addEventListener('click', () => {
      document.getElementById('mobileDrawerBackdrop')?.classList.remove('active');
      showBanner();
    });

    // Afficher la bannière si aucun choix n'a encore été fait
    const status = StorageManager.getConsentStatus();
    if (!status) {
      setTimeout(() => {
        showBanner();
      }, 400);
    }

    // Auto-sauvegarde sur départ ou masquage de l'onglet
    window.addEventListener('beforeunload', () => {
      this.saveCurrentSession();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.saveCurrentSession();
      }
    });
  }

  async startupSession() {
    let restored = false;
    if (StorageManager.hasConsent()) {
      restored = await this.restoreSavedSession();
    }
    if (!restored) {
      this.loadInitialDemo();
    }
  }

  scheduleAutoSave() {
    if (!StorageManager.hasConsent()) return;
    clearTimeout(this.autoSaveTimer);
    this.autoSaveTimer = setTimeout(() => {
      this.saveCurrentSession();
    }, 600);
  }

  async saveCurrentSession() {
    if (!StorageManager.hasConsent()) return false;
    try {
      const projectData = {
        version: 'RHYTHMO_V5',
        video: this.currentMediaFile?.name || null,
        bandCount: this.textManager.bandCount,
        pixelsPerSecond: this.pps,
        roles: this.textManager.roles.map(r => ({
          name: r.name,
          color: Role.hexToInt(r.color)
        })),
        texts: this.textManager.texts.map(t => ({
          text: t.text,
          x: t.x,
          band: t.band,
          role: t.role ? t.role.name : ''
        })),
        separators: [],
        planMarkers: [...this.textManager.planMarkers]
      };

      for (const [band, seps] of this.textManager.bandSeparators.entries()) {
        for (const s of seps) {
          projectData.separators.push({
            band: band,
            x: s.x,
            type: s.type,
            splitIndex: s.splitIndex,
            signType: s.signType || 'DEFAULT',
            rawDetxType: s.rawDetxType || ''
          });
        }
      }

      await StorageManager.saveSession({
        project: projectData,
        videoBlob: this.currentMediaFile || null,
        videoName: this.currentMediaFile?.name || null,
        videoType: this.currentMediaFile?.type || null,
        videoLastModified: this.currentMediaFile?.lastModified || null,
        currentTime: this.videoSync.currentTime || 0,
        pps: this.pps
      });
      return true;
    } catch (e) {
      console.warn('[AutoSave] Erreur lors de la sauvegarde :', e);
      return false;
    }
  }

  async restoreSavedSession() {
    if (!StorageManager.hasConsent()) return false;
    try {
      const saved = await StorageManager.loadSession();
      if (!saved || !saved.project) return false;

      // 1. Restaurer le projet rythmo
      const projectJson = JSON.stringify(saved.project);
      const meta = ProjectIO.importRythmo(projectJson, this.textManager);

      if (meta && typeof meta.pixelsPerSecond === 'number' && meta.pixelsPerSecond > 0) {
        this.setPps(meta.pixelsPerSecond, false);
      } else if (typeof saved.pps === 'number' && saved.pps > 0) {
        this.setPps(saved.pps, false);
      }

      // 2. Restaurer le média vidéo / audio si stocké
      if (saved.videoBlob) {
        const videoFile = (saved.videoBlob instanceof File)
          ? saved.videoBlob
          : new File([saved.videoBlob], saved.videoName || 'video_sauvegardee.mp4', {
              type: saved.videoType || 'video/mp4',
              lastModified: saved.videoLastModified || Date.now()
            });

        await this.loadMediaFile(videoFile, false);
        if (typeof saved.currentTime === 'number' && saved.currentTime > 0) {
          this.videoSync.seekTo(saved.currentTime);
        }
        this.showToast(`✨ Session restaurée : bande & vidéo "${saved.videoName || 'vidéo'}" retrouvées !`, 3200);
      } else if (saved.project.video) {
        this.updatePlaceholderForProject('Session restaurée', saved.project.video);
        this.showToast(`✨ Bande rythmo restaurée ! Vidéo attendue : ${saved.project.video}`, 3000);
      } else {
        this.showToast('✨ Bande rythmo restaurée depuis votre dernière session !', 2500);
      }

      this.render();
      return true;
    } catch (err) {
      console.warn('[OmeRythApp] Erreur restauration session :', err);
      return false;
    }
  }

  loadInitialDemo() {
    // Projet d'exemple immédiat et interactif
    this.textManager = new TextManager(4);
    if (this.touchControls) {
      this.touchControls.textManager = this.textManager;
    }
    const pps = this.pps;

    const rNarrateur = this.textManager.roles[0];
    const rPerso1 = this.textManager.roles[1];
    const rPerso2 = this.textManager.roles[2];

    // Réplique 1 : 1.0s à 3.2s
    const t1Start = 1.0 * pps;
    const t1End = 3.2 * pps;
    this.textManager.addTextItem(new TextItem("Bonjour et bienvenue sur OmeRyth Web !", t1Start, 0, rNarrateur), false);
    this.textManager.addSeparator(0, t1Start, SeparatorType.START, -1, 'DEFAULT', null, false);
    this.textManager.addSeparator(0, 1.8 * pps, SeparatorType.INNER, 21, 'OPEN_A', null, false); // Signe A sur "bienvenue"
    this.textManager.addSeparator(0, t1End, SeparatorType.END, -1, 'DEFAULT', null, false);

    // Réplique 2 : 3.8s à 5.8s
    const t2Start = 3.8 * pps;
    const t2End = 5.8 * pps;
    this.textManager.addTextItem(new TextItem("Tout fonctionne directement depuis votre navigateur !", t2Start, 1, rPerso1), false);
    this.textManager.addSeparator(1, t2Start, SeparatorType.START, -1, 'DEFAULT', null, false);
    this.textManager.addSeparator(1, 4.7 * pps, SeparatorType.INNER, 28, 'FVR', null, false); // Signe F sur "directement"
    this.textManager.addSeparator(1, t2End, SeparatorType.END, -1, 'DEFAULT', null, false);

    // Réplique 3 : 6.4s à 8.6s
    const t3Start = 6.4 * pps;
    const t3End = 8.6 * pps;
    this.textManager.addTextItem(new TextItem("Compatible ordinateur, tablette et smartphone.", t3Start, 2, rPerso2), false);
    this.textManager.addSeparator(2, t3Start, SeparatorType.START, -1, 'DEFAULT', null, false);
    this.textManager.addSeparator(2, 7.3 * pps, SeparatorType.INNER, 22, 'MPB', null, false); // Signe M sur "tablette"
    this.textManager.addSeparator(2, t3End, SeparatorType.END, -1, 'DEFAULT', null, false);

    // Repères de plans d'exemple
    this.textManager.addPlanMarker(3.5 * pps, false);
    this.textManager.addPlanMarker(6.1 * pps, false);

    this.render();
  }

  // --- Fonctions de Transcription Vocale IA (Whisper) ---
  snapWorldXToTenth(worldX) {
    const step = this.pps * 0.1;
    if (step <= 0) return Math.round(worldX);
    return Math.round(Math.round(worldX / step) * step);
  }

  formatSec(sec) {
    if (typeof sec !== 'number' || isNaN(sec)) return '00:00.0';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.floor((sec % 1) * 10);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms}`;
  }

  initTranscribeModal() {
    const modal = document.getElementById('transcribeModal');

    const notifyUnavailable = () => {
      this.showToast("🎙️ La transcription n'est pas encore disponible pour l'instant.", 2800);
    };

    // Au clic sur transcription : afficher une notification et ne pas ouvrir la fenêtre
    document.getElementById('btnTranscribe')?.addEventListener('click', notifyUnavailable);
    document.getElementById('btnMobileTranscribe')?.addEventListener('click', notifyUnavailable);
    document.getElementById('mBtnTranscribe')?.addEventListener('click', () => {
      document.getElementById('mobileDrawerBackdrop')?.classList.remove('active');
      notifyUnavailable();
    });

    if (!modal) return;

    const openModal = () => {
      this.updateTranscribeMediaCard();
      this.updateTranscribeTargetBands();
      modal.classList.add('active');
    };

    const closeModal = () => {
      if (this.transcribeInterval) {
        if (confirm("Une transcription est en cours d'exécution. Souhaitez-vous l'annuler et fermer ?")) {
          this.cancelTranscription();
          modal.classList.remove('active');
        }
      } else {
        modal.classList.remove('active');
      }
    };

    document.getElementById('btnCloseTranscribeModal')?.addEventListener('click', closeModal);
    document.getElementById('btnCancelTranscribe')?.addEventListener('click', closeModal);

    document.getElementById('btnSelectMediaInModal')?.addEventListener('click', () => {
      document.getElementById('fileInputMedia')?.click();
    });

    document.getElementById('btnStartTranscribe')?.addEventListener('click', () => {
      this.startTranscription();
    });
  }

  updateTranscribeMediaCard() {
    const titleEl = document.getElementById('transcribeMediaTitle');
    const subEl = document.getElementById('transcribeMediaSub');
    const btnStart = document.getElementById('btnStartTranscribe');
    if (!titleEl || !subEl) return;

    if (this.currentMediaFile) {
      const mb = (this.currentMediaFile.size / (1024 * 1024)).toFixed(1);
      titleEl.textContent = this.currentMediaFile.name;
      subEl.textContent = `Prêt pour l'analyse IA (${mb} Mo)`;
      if (btnStart) btnStart.disabled = false;
    } else {
      titleEl.textContent = 'Aucun média chargé';
      subEl.textContent = 'Veuillez charger une vidéo ou un fichier audio pour transcrire.';
      if (btnStart) btnStart.disabled = true;
    }
  }

  updateTranscribeTargetBands() {
    const sel = document.getElementById('transcribeTargetBand');
    if (!sel) return;
    sel.innerHTML = '';
    const total = Math.max(1, this.textManager.bandCount);
    for (let i = 0; i < total; i++) {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = `Bande ${i + 1}${i === 0 ? ' (Principale)' : ''}`;
      if (i === this.activeBand) opt.selected = true;
      sel.appendChild(opt);
    }
  }

  async startTranscription() {
    if (!this.currentMediaFile) {
      this.showToast('Veuillez d\'abord charger un fichier audio ou vidéo.');
      document.getElementById('fileInputMedia')?.click();
      return;
    }

    const lang = document.getElementById('transcribeLang')?.value || 'fr';
    const model = document.getElementById('transcribeModel')?.value || 'small';
    const speakers = document.getElementById('transcribeSpeakers')?.value || '0';
    const targetBand = parseInt(document.getElementById('transcribeTargetBand')?.value || '0', 10);

    const progressArea = document.getElementById('transcribeProgressArea');
    const progressBar = document.getElementById('transcribeProgressBar');
    const progressMsg = document.getElementById('transcribeProgressMsg');
    const progressPct = document.getElementById('transcribeProgressPct');
    const liveScroll = document.getElementById('transcribeLiveScroll');
    const btnStart = document.getElementById('btnStartTranscribe');
    const btnCancel = document.getElementById('btnCancelTranscribe');
    const formGrid = document.getElementById('transcribeFormGrid');

    if (progressArea) progressArea.style.display = 'block';
    if (liveScroll) liveScroll.innerHTML = '';
    if (progressBar) progressBar.style.width = '5%';
    if (progressMsg) progressMsg.textContent = 'Envoi du fichier média au serveur local...';
    if (progressPct) progressPct.textContent = '5%';
    if (btnStart) btnStart.disabled = true;
    if (btnCancel) btnCancel.textContent = 'Annuler';
    if (formGrid) formGrid.style.opacity = '0.5';

    try {
      const query = new URLSearchParams({
        lang,
        model,
        speakers,
        band: targetBand
      });

      const res = await fetch(`/api/transcribe?${query.toString()}`, {
        method: 'POST',
        headers: {
          'Content-Type': this.currentMediaFile.type || 'application/octet-stream',
          'X-Filename': encodeURIComponent(this.currentMediaFile.name)
        },
        body: this.currentMediaFile
      });

      if (!res.ok) {
        throw new Error(`Erreur serveur (${res.status}): ${await res.text()}`);
      }

      const data = await res.json();
      this.transcribeTaskId = data.task_id;
      let seenCount = 0;

      // Boucle de suivi de progression (500ms)
      if (this.transcribeInterval) clearInterval(this.transcribeInterval);
      this.transcribeInterval = setInterval(async () => {
        if (!this.transcribeTaskId) {
          clearInterval(this.transcribeInterval);
          this.transcribeInterval = null;
          return;
        }

        try {
          const statusRes = await fetch(`/api/transcribe/status?task_id=${this.transcribeTaskId}`);
          if (!statusRes.ok) return;
          const statusData = await statusRes.json();

          const progress = Math.max(5, Math.min(100, statusData.progress || 0));
          if (progressBar) progressBar.style.width = `${progress}%`;
          if (progressPct) progressPct.textContent = `${progress}%`;
          if (progressMsg && statusData.message) progressMsg.textContent = statusData.message;

          // Affichage en direct des répliques
          const allSegments = (statusData.segments && statusData.segments.length > 0) 
            ? statusData.segments 
            : (statusData.live_segments || []);

          if (liveScroll && allSegments.length > seenCount) {
            for (let i = seenCount; i < allSegments.length; i++) {
              const seg = allSegments[i];
              const itemDiv = document.createElement('div');
              itemDiv.className = 'live-feed-item';
              const spkSpan = document.createElement('span');
              spkSpan.className = 'live-feed-speaker';
              spkSpan.textContent = `[${seg.speaker || 'Voix'}] `;
              const timeSpan = document.createElement('span');
              timeSpan.className = 'live-feed-time';
              timeSpan.textContent = `${this.formatSec(seg.start)} ➔ ${this.formatSec(seg.end)}: `;
              const txtSpan = document.createElement('span');
              txtSpan.className = 'live-feed-text';
              txtSpan.textContent = seg.text || '';
              itemDiv.appendChild(spkSpan);
              itemDiv.appendChild(timeSpan);
              itemDiv.appendChild(txtSpan);
              liveScroll.appendChild(itemDiv);
            }
            seenCount = allSegments.length;
            liveScroll.scrollTop = liveScroll.scrollHeight;
          }

          if (statusData.status === 'done') {
            clearInterval(this.transcribeInterval);
            this.transcribeInterval = null;
            if (progressBar) progressBar.style.width = '100%';
            if (progressPct) progressPct.textContent = '100%';
            if (progressMsg) progressMsg.textContent = 'Génération de la bande rythmo terminée avec succès !';
            if (btnCancel) btnCancel.textContent = 'Fermer';

            const finalSegments = (statusData.segments && statusData.segments.length > 0) ? statusData.segments : allSegments;
            this.importTranscriptionSegments(finalSegments, targetBand);

            setTimeout(() => {
              document.getElementById('transcribeModal')?.classList.remove('active');
              this.resetTranscribeUI();
            }, 1200);

          } else if (statusData.status === 'error') {
            clearInterval(this.transcribeInterval);
            this.transcribeInterval = null;
            alert('Erreur lors de la transcription : ' + (statusData.error || 'Erreur inconnue'));
            this.resetTranscribeUI();
          } else if (statusData.status === 'cancelled') {
            clearInterval(this.transcribeInterval);
            this.transcribeInterval = null;
            this.resetTranscribeUI();
          }
        } catch (err) {
          console.warn('Erreur lors du sondage de transcription:', err);
        }
      }, 500);

    } catch (err) {
      alert('Impossible de lancer la transcription : ' + err.message);
      this.resetTranscribeUI();
    }
  }

  async cancelTranscription() {
    if (this.transcribeTaskId) {
      try {
        await fetch(`/api/transcribe/cancel?task_id=${this.transcribeTaskId}`, { method: 'POST' });
      } catch (e) {
        console.warn('Erreur annulation transcription:', e);
      }
    }
    if (this.transcribeInterval) {
      clearInterval(this.transcribeInterval);
      this.transcribeInterval = null;
    }
    this.transcribeTaskId = null;
    this.resetTranscribeUI();
    this.showToast('Transcription annulée.');
  }

  resetTranscribeUI() {
    const progressArea = document.getElementById('transcribeProgressArea');
    const progressBar = document.getElementById('transcribeProgressBar');
    const progressMsg = document.getElementById('transcribeProgressMsg');
    const progressPct = document.getElementById('transcribeProgressPct');
    const btnStart = document.getElementById('btnStartTranscribe');
    const btnCancel = document.getElementById('btnCancelTranscribe');
    const formGrid = document.getElementById('transcribeFormGrid');

    if (progressArea) progressArea.style.display = 'none';
    if (progressBar) progressBar.style.width = '0%';
    if (progressPct) progressPct.textContent = '0%';
    if (progressMsg) progressMsg.textContent = 'Préparation...';
    if (btnStart) btnStart.disabled = !this.currentMediaFile;
    if (btnCancel) btnCancel.textContent = 'Fermer';
    if (formGrid) formGrid.style.opacity = '1';
  }

  importTranscriptionSegments(segments, baseTargetBand = 0) {
    if (!segments || segments.length === 0) {
      this.showToast('Aucune réplique vocale détectée.');
      return;
    }

    this.textManager.recordSnapshot();
    const pps = this.pps;
    const speakerColors = ['#FF6B6B', '#4ECDC4', '#FFD166', '#A06CD5', '#1DD1A1', '#FF9F43', '#54A0FF', '#EE5253'];

    // 1. Extraire et mapper les locuteurs vers des rôles
    const speakerRolesMap = new Map();
    let maxSpeakerIdx = 0;

    const parseSpeakerIndex = (spk) => {
      if (!spk) return 0;
      const str = String(spk).trim();
      const match = str.match(/SPEAKER[_\s-]?(\d+)/i) || str.match(/(\d+)/);
      if (match) {
        return parseInt(match[1], 10);
      }
      return 0;
    };

    for (const seg of segments) {
      const spkIdx = parseSpeakerIndex(seg.speaker);
      if (spkIdx > maxSpeakerIdx) maxSpeakerIdx = spkIdx;
      if (!speakerRolesMap.has(spkIdx)) {
        const roleName = `Personnage ${spkIdx + 1}`;
        let foundRole = this.textManager.roles.find(r => r.name && r.name.toLowerCase() === roleName.toLowerCase());
        if (!foundRole) {
          const color = speakerColors[spkIdx % speakerColors.length];
          foundRole = new Role(roleName, color);
          this.textManager.roles.push(foundRole);
        }
        speakerRolesMap.set(spkIdx, foundRole);
      }
    }

    // 2. Calcul de la bande maximale nécessaire et extension automatique
    const maxNeededBand = baseTargetBand + maxSpeakerIdx;
    if (maxNeededBand >= this.textManager.bandCount) {
      this.textManager.setBandCount(maxNeededBand + 1);
    }

    // Nettoyer les bandes de destination pour éviter tout chevauchement
    for (let b = baseTargetBand; b <= maxNeededBand; b++) {
      this.textManager.texts = this.textManager.texts.filter(t => t.band !== b);
      if (this.textManager.bandSeparators.has(b)) {
        this.textManager.bandSeparators.get(b).length = 0;
      }
    }

    // 3. Regrouper les segments par bande
    const segmentsByBand = new Map();
    for (const seg of segments) {
      const spkIdx = parseSpeakerIndex(seg.speaker);
      const band = baseTargetBand + spkIdx;
      if (!segmentsByBand.has(band)) {
        segmentsByBand.set(band, []);
      }
      segmentsByBand.get(band).push(seg);
    }

    const MAX_PAUSE_GAP_SEC = 0.22;
    const minStep = Math.max(10, Math.round(pps * 0.1));

    for (const [band, bandSegments] of segmentsByBand.entries()) {
      bandSegments.sort((a, b) => (a.start || 0) - (b.start || 0));

      // Déduplication de segments superposés ou identiques
      const cleanBandSegments = [];
      for (const seg of bandSegments) {
        if (!seg.text || !seg.text.trim()) continue;
        if (cleanBandSegments.length > 0) {
          const prevSeg = cleanBandSegments[cleanBandSegments.length - 1];
          if (Math.abs(seg.start - prevSeg.start) < 0.05 && Math.abs(seg.end - prevSeg.end) < 0.05) {
            if (seg.text.trim().length > prevSeg.text.trim().length) {
              cleanBandSegments[cleanBandSegments.length - 1] = seg;
            }
            continue;
          }
          if (seg.start < prevSeg.end - 0.1 && seg.text.trim().toLowerCase() === prevSeg.text.trim().toLowerCase()) {
            continue;
          }
        }
        cleanBandSegments.push(seg);
      }

      // Découper en répliques rythmo naturelles indépendantes
      const phraseGroups = [];
      let currentGroup = [];

      for (const seg of cleanBandSegments) {
        if (currentGroup.length === 0) {
          currentGroup.push(seg);
        } else {
          const prev = currentGroup[currentGroup.length - 1];
          const gap = seg.start - prev.end;
          const prevTxt = prev.text ? prev.text.trim() : '';
          const prevHasPunct = /[\.!?\u2026:]$/.test(prevTxt);
          const groupDur = prev.end - currentGroup[0].start;

          if (gap >= MAX_PAUSE_GAP_SEC || (prevHasPunct && gap >= 0.15) || groupDur >= 5.0) {
            phraseGroups.push(currentGroup);
            currentGroup = [];
          }
          currentGroup.push(seg);
        }
      }
      if (currentGroup.length > 0) {
        phraseGroups.push(currentGroup);
      }

      let lastCommittedEndX = 0;

      // Insérer chaque groupe de phrases
      for (const group of phraseGroups) {
        if (group.length === 0) continue;

        const spkIdx = parseSpeakerIndex(group[0].speaker);
        const spkRole = speakerRolesMap.get(spkIdx);

        if (group.length === 1) {
          // Phrase unitaire classique : Début propre [START] et Fin propre [END]
          const seg = group[0];
          const txt = (seg.text || '').trim();
          if (!txt) continue;

          let segStartSec = Math.round((seg.start || 0) * 100.0) / 100.0;
          let segEndSec = Math.round((seg.end || 0) * 100.0) / 100.0;
          if (segEndSec <= segStartSec) {
            segEndSec = segStartSec + 0.3;
          }

          let segStartX = this.snapWorldXToTenth(Math.round(segStartSec * pps));
          let segEndX = this.snapWorldXToTenth(Math.round(segEndSec * pps));
          if (segStartX < lastCommittedEndX + minStep) {
            segStartX = lastCommittedEndX + minStep;
          }
          if (segEndX - segStartX < minStep) {
            segEndX = segStartX + minStep;
          }
          lastCommittedEndX = segEndX;

          const item = new TextItem(txt, segStartX, band, spkRole);
          this.textManager.addTextItem(item, false);

          this.textManager.addSeparator(band, segStartX, SeparatorType.START, -1, 'DEFAULT', null, false);
          this.textManager.addSeparator(band, segEndX, SeparatorType.END, -1, 'DEFAULT', null, false);
        } else {
          // Micro-enchaînement (gap < 0.22s) : relié par des séparateurs internes
          const groupStartSec = Math.round((group[0].start || 0) * 100.0) / 100.0;
          let groupStartX = this.snapWorldXToTenth(Math.round(groupStartSec * pps));
          if (groupStartX < lastCommittedEndX + minStep) {
            groupStartX = lastCommittedEndX + minStep;
          }

          let fullText = '';
          const inners = [];
          let lastEndX = groupStartX;

          for (let i = 0; i < group.length; i++) {
            const seg = group[i];
            const txt = (seg.text || '').trim();
            if (!txt) continue;

            let segStartSec = Math.round((seg.start || 0) * 100.0) / 100.0;
            let segEndSec = Math.round((seg.end || 0) * 100.0) / 100.0;
            if (segEndSec <= segStartSec) {
              segEndSec = segStartSec + 0.3;
            }

            let segStartX = this.snapWorldXToTenth(Math.round(segStartSec * pps));
            let segEndX = this.snapWorldXToTenth(Math.round(segEndSec * pps));
            if (segEndX - segStartX < minStep) {
              segEndX = segStartX + minStep;
            }

            if (i === 0) {
              fullText += txt;
              lastEndX = Math.max(groupStartX + minStep, segEndX);
            } else {
              fullText += ' ';
              const splitIndex = fullText.length;
              const sepX = Math.max(lastEndX, segStartX);
              inners.push({ x: sepX, splitIndex });
              fullText += txt;
              lastEndX = Math.max(sepX + minStep, segEndX);
            }
          }

          if (!fullText) continue;

          let curX = groupStartX;
          for (const sep of inners) {
            sep.x = Math.max(curX + minStep, sep.x);
            curX = sep.x;
          }
          const finalEndX = Math.max(curX + minStep, lastEndX);
          lastCommittedEndX = finalEndX;

          const item = new TextItem(fullText, groupStartX, band, spkRole);
          this.textManager.addTextItem(item, false);

          this.textManager.addSeparator(band, groupStartX, SeparatorType.START, -1, 'DEFAULT', null, false);
          for (const sep of inners) {
            this.textManager.addSeparator(band, sep.x, SeparatorType.INNER, sep.splitIndex, 'DEFAULT', null, false);
          }
          this.textManager.addSeparator(band, finalEndX, SeparatorType.END, -1, 'DEFAULT', null, false);
        }
      }
    }

    this.render();
    const distinctSpeakers = speakerRolesMap.size;
    if (distinctSpeakers > 1) {
      this.showToast(`${segments.length} répliques synchronisées sur ${distinctSpeakers} personnages !`);
    } else {
      this.showToast(`${segments.length} répliques synchronisées sur la bande ${baseTargetBand + 1} !`);
    }
  }

  initVideoPromptModal() {
    const modal = document.getElementById('videoPromptModal');
    const btnClose = document.getElementById('btnCloseVideoPromptModal');
    const btnSkip = document.getElementById('btnSkipPromptVideo');
    const btnChoose = document.getElementById('btnChoosePromptVideo');

    const closeModal = () => {
      if (modal) modal.classList.remove('active');
    };

    btnClose?.addEventListener('click', closeModal);
    btnSkip?.addEventListener('click', closeModal);
    btnChoose?.addEventListener('click', () => {
      closeModal();
      document.getElementById('fileInputMedia')?.click();
    });
  }

  openVideoPromptModal(projectName, expectedVideo = null) {
    const modal = document.getElementById('videoPromptModal');
    const pProj = document.getElementById('videoPromptProjectName');
    const pExp = document.getElementById('videoPromptExpected');
    const sExp = document.getElementById('videoPromptExpectedName');

    if (pProj) pProj.textContent = `Projet "${projectName}" chargé avec succès`;
    if (sExp && pExp) {
      if (expectedVideo) {
        sExp.textContent = expectedVideo;
        pExp.style.display = 'block';
      } else {
        pExp.style.display = 'none';
      }
    }

    if (modal) {
      modal.classList.add('active');
    }
  }

  updateFpsBadge() {
    const btnToggleFps = document.getElementById('btnToggleFps');
    if (btnToggleFps) {
      btnToggleFps.textContent = `${Math.round(this.videoSync.fps)} IPS`;
    }
  }

  handleVideoError(e) {
    console.error('Erreur de lecture vidéo :', this.videoEl?.error);
    const err = this.videoEl?.error;
    let msg = "Impossible de lire le fichier vidéo. Le format ou codec n'est pas pris en charge par votre navigateur (ex: HEVC/H.265 ou AC3). Utilisez de préférence un fichier MP4 (H.264 / AAC) ou WebM.";
    if (err && err.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
      msg = "Format ou codec non supporté par ce navigateur (privilégiez MP4 H.264 ou WebM).";
    }
    this.showToast(`⚠️ ${msg}`, 6000);
    if (this.videoPlaceholder) {
      this.videoPlaceholder.style.display = 'flex';
      this.videoPlaceholder.innerHTML = `
        <div class="icon" style="color: #ff5555;">⚠️</div>
        <p style="color: #ff7777;"><strong>Erreur de lecture vidéo</strong></p>
        <p style="font-size: 12px; max-width: 380px; margin: 0 auto 12px auto; color: var(--text-muted);">${msg}</p>
        <button class="btn btn-sm btn-primary" onclick="document.getElementById('fileInputMedia').click()">Choisir une autre vidéo</button>
      `;
      this.videoEl.style.display = 'none';
    }
  }
}

// Initialisation au chargement de la page
window.addEventListener('DOMContentLoaded', () => {
  window.app = new OmeRythApp();
});

