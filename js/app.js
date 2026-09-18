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

export class OmeRythApp {
  constructor() {
    this.pps = 80.0; // Pixels par seconde
    this.activeBand = 0;
    this.selectedItem = null;
    this.selectedSeparator = null;
    this.selectedPlanMarker = null;
    this.contextTarget = null;
    this.currentMediaFile = null;
    this.transcribeTaskId = null;
    this.transcribeInterval = null;

    // Instances principales
    this.textManager = new TextManager(4);
    this.waveform = new AudioWaveform();

    this.canvas = document.getElementById('timelineCanvas');
    this.videoEl = document.getElementById('videoPlayer');
    this.videoPlaceholder = document.getElementById('videoPlaceholder');

    this.renderer = new TimelineRenderer(this.canvas);
    this.videoSync = new VideoSync(this.videoEl, (time) => this.onTimeUpdate(time));
    this.videoSync.pps = this.pps;

    this.touchControls = new TouchControls(this.canvas, this.renderer, this.textManager, this.videoSync, () => this.render());
    this.touchControls.onContextMenu = (info) => this.openContextMenuAt(info.worldX, info.bandIdx, info.clientX, info.clientY);
    this.touchControls.onDoubleTap = (worldX, bandIdx) => this.handleDoubleTap(worldX, bandIdx);
    this.touchControls.onTap = (info) => this.handleTap(info.worldX, info.bandIdx);

    this.shortcuts = new ShortcutsManager(this);

    this.initUI();
    this.initCanvasMouseEvents();
    this.initContextMenu();
    this.initMobileDrawer();
    this.initTranscribeModal();
    this.initResizeHandler();

    // Démarrage propre : ne rien mettre au début par défaut
    this.render();
  }

  initUI() {
    // --- Barre de transport ---
    const btnPlay = document.getElementById('btnPlay');
    if (btnPlay) {
      btnPlay.addEventListener('click', () => this.togglePlayPause());
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
      this.pps = Math.min(240, this.pps * 1.25);
      this.videoSync.pps = this.pps;
      this.render();
    });

    document.getElementById('btnZoomOut')?.addEventListener('click', () => {
      this.pps = Math.max(30, this.pps * 0.8);
      this.videoSync.pps = this.pps;
      this.render();
    });

    document.getElementById('btnWaveform')?.addEventListener('click', () => this.toggleWaveform());

    document.getElementById('btnSigns')?.addEventListener('click', () => {
      this.renderer.separatorsVisible = !this.renderer.separatorsVisible;
      this.render();
      this.showToast(this.renderer.separatorsVisible ? 'Signes affichés' : 'Signes masqués');
    });

    // --- Gestion de Projet (Nouveau, Ouvrir, Sauvegarder, Démo) ---
    document.getElementById('btnNew')?.addEventListener('click', () => {
      if (confirm('Créer un nouveau projet vierge ? Les modifications non enregistrées seront perdues.')) {
        this.textManager = new TextManager(4);
        this.render();
        this.showToast('Nouveau projet initialisé');
      }
    });

    document.getElementById('btnSave')?.addEventListener('click', () => this.exportProject());

    document.getElementById('btnExportSrt')?.addEventListener('click', () => {
      ProjectIO.exportSrt(this.textManager, this.pps);
      this.showToast('Fichier SRT généré !');
    });

    const fileInputProject = document.getElementById('fileInputProject');
    document.getElementById('btnOpen')?.addEventListener('click', () => {
      fileInputProject?.click();
    });

    fileInputProject?.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (evt) => {
          try {
            ProjectIO.importRythmo(evt.target.result, this.textManager);
            this.render();
            this.showToast(`Projet "${file.name}" chargé avec succès !`);
          } catch (err) {
            alert('Erreur lors du chargement du fichier .rythmo : ' + err.message);
          }
        };
        reader.readAsText(file);
      }
    });

    // --- Chargement Média (Vidéo / Audio) ---
    const fileInputMedia = document.getElementById('fileInputMedia');
    document.getElementById('btnLoadMedia')?.addEventListener('click', () => {
      fileInputMedia?.click();
    });

    fileInputMedia?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (file) {
        await this.loadMediaFile(file);
      }
    });

    // Bouton Démo
    document.getElementById('btnDemo')?.addEventListener('click', () => {
      this.loadInitialDemo();
      this.showToast('Projet de démonstration chargé !');
    });

    // Bouton Rôles
    document.getElementById('btnRoles')?.addEventListener('click', () => this.openRolesModal());

    // Bouton Aide
    document.getElementById('btnHelp')?.addEventListener('click', () => {
      document.getElementById('helpModal').classList.add('active');
    });

    // Boutons de la barre mobile supérieure
    document.getElementById('btnMobileMedia')?.addEventListener('click', () => {
      fileInputMedia?.click();
    });

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
        const file = e.dataTransfer.files[0];
        const nameLower = file.name.toLowerCase();
        if (nameLower.endsWith('.rythmo') || nameLower.endsWith('.json')) {
          const text = await file.text();
          ProjectIO.importRythmo(text, this.textManager);
          this.render();
          this.showToast(`Projet "${file.name}" importé !`);
        } else if (file.type.startsWith('video/') || file.type.startsWith('audio/') || nameLower.endsWith('.mkv')) {
          await this.loadMediaFile(file);
        }
      }
    });
  }

  async loadMediaFile(file) {
    this.currentMediaFile = file;
    this.updateTranscribeMediaCard();
    this.showToast(`Chargement de "${file.name}"...`);
    const objectUrl = URL.createObjectURL(file);
    this.videoSync.loadSource(objectUrl);
    if (this.videoPlaceholder) {
      this.videoPlaceholder.style.display = 'none';
    }
    this.videoEl.style.display = 'block';

    // Règle : ne rien mettre au début lors de l'ouverture d'un média (timeline vierge et curseur à 0)
    this.textManager = new TextManager(4);
    this.videoSync.seekTo(0);
    this.render();

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
        this.textManager.moveSeparator(dragBand, dragTarget.x, newWorldX);
        this.render();
      }
    });

    window.addEventListener('mouseup', () => {
      // Clic simple sur un texte sans glisser : ouverture de la modification dynamique
      if (isMouseDown && !hasMovedSinceDown && clickedTextCandidate && dragMode === 'scrub') {
        this.openTextEditModal(clickedTextCandidate);
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
          this.openTextEditModal(existingText);
        } else {
          this.openNewTextModal(bandIdx, worldX);
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
        this.pps = Math.max(30, Math.min(this.pps * factor, 240));
        this.videoSync.pps = this.pps;
        this.render();
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
      const container = this.canvas.parentElement;
      if (container) {
        const w = container.clientWidth;
        const h = container.clientHeight > 0 ? container.clientHeight : 160;
        this.renderer.resize(w, h);
        this.render();
      }
    };

    window.addEventListener('resize', handleResize);
    setTimeout(handleResize, 50);
  }

  onTimeUpdate(currentTime) {
    const tcDisplay = document.getElementById('timecodeDisplay');
    if (tcDisplay) {
      tcDisplay.textContent = this.videoSync.formatTimecode(currentTime);
    }
    this.render();
  }

  render() {
    this.renderer.render(
      this.textManager,
      this.videoSync.currentTime,
      this.pps,
      this.waveform
    );
  }

  togglePlayPause() {
    this.videoSync.togglePlayPause();
    const btnPlay = document.getElementById('btnPlay');
    if (btnPlay) {
      btnPlay.innerHTML = this.videoSync.isPlaying 
        ? '<span class="play-icon">⏸</span><span class="play-text"> Pause</span>' 
        : '<span class="play-icon">▶</span><span class="play-text"> Lecture</span>';
    }
  }

  toggleWaveform() {
    this.renderer.waveformVisible = !this.renderer.waveformVisible;
    this.render();
    this.showToast(this.renderer.waveformVisible ? 'Waveform affichée' : 'Waveform masquée');
  }

  addSeparatorAtCursor(type = 'START') {
    const currentWorldX = this.snapWorldXToTenth(this.videoSync.currentTime * this.pps);
    this.textManager.addSeparator(this.activeBand, currentWorldX, type);
    this.render();
    if (type === 'START' || type === SeparatorType.START) {
      this.openPromptForStart(this.activeBand, currentWorldX);
    } else {
      this.showToast(`Séparateur ${type} ajouté sur la bande ${this.activeBand + 1}`);
    }
  }

  addSignAtCursor(signTypeId) {
    const currentWorldX = this.snapWorldXToTenth(this.videoSync.currentTime * this.pps);
    this.textManager.addSeparator(this.activeBand, currentWorldX, SeparatorType.INNER, -1, signTypeId);
    this.render();
    this.showToast(`Signe ${signTypeId} posé sur la bande ${this.activeBand + 1}`);
  }

  addPlanMarkerAtCursor() {
    const currentWorldX = this.snapWorldXToTenth(this.videoSync.currentTime * this.pps);
    this.textManager.addPlanMarker(currentWorldX);
    this.render();
    this.showToast(`Repère de plan posé à ${this.videoSync.currentTime.toFixed(2)}s`);
  }

  undo() {
    if (this.textManager.undo()) {
      this.render();
      this.showToast('Annuler (Undo)');
    }
  }

  redo() {
    if (this.textManager.redo()) {
      this.render();
      this.showToast('Rétablir (Redo)');
    }
  }

  deleteSelection() {
    if (this.selectedItem) {
      this.textManager.removeTextItem(this.selectedItem);
      this.selectedItem = null;
      this.render();
      this.showToast('Réplique supprimée');
    }
  }

  exportProject() {
    ProjectIO.exportRythmo(this.textManager, this.pps, this.videoEl?.src || null);
    this.showToast('Projet .rythmo téléchargé !');
  }

  openPromptForStart(bandIdx, worldX) {
    // Si un texte existe déjà sous ce repère, on passe en mode modification
    const existing = this.textManager.findTextAt(bandIdx, worldX, this.pps);
    if (existing) {
      this.openTextEditModal(existing);
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
      if (trimmed) {
        liveItem.text = trimmed;
        liveItem.role = this.textManager.getRoleByName(roleSelect.value);

        // Poser automatiquement un repère END si pas encore de fin sur ce tronçon
        const bounds = this.textManager.getBoundarySeparators(bandIdx, worldX);
        if (bounds.rightSep === null || bounds.rightSep <= worldX) {
          const estimatedDur = Math.max(1.2, trimmed.length * 0.08);
          const endX = this.snapWorldXToTenth(worldX + estimatedDur * this.pps);
          this.textManager.addSeparator(bandIdx, endX, SeparatorType.END, -1, 'DEFAULT', null, false);
        }

        this.textManager.recordSnapshot();
        this.render();
        this.showToast(`Réplique enregistrée pour ${liveItem.role?.name || 'Personnage'}`);
      } else {
        // Aucun texte : retirer l'élément temporaire, mais préserver le repère START
        this.textManager.removeTextItem(liveItem, false);
        this.render();
        this.showToast('Repère START posé');
      }
      cleanup();
    };

    const onCancel = () => {
      this.textManager.removeTextItem(liveItem, false);
      this.render();
      this.showToast('Repère START posé');
      cleanup();
    };

    if (btnSave) btnSave.onclick = onSave;
    if (btnCancel) btnCancel.onclick = onCancel;
    if (btnClose) btnClose.onclick = onCancel;

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
    this.textManager.addSeparator(bandIdx, snappedX, SeparatorType.START);
    this.render();
    this.openPromptForStart(bandIdx, snappedX);
  }

  openTextEditModal(textItem) {
    if (!textItem) return;
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
        this.textManager.recordSnapshot();
        this.render();
        this.showToast('Réplique modifiée !');
      } else {
        if (confirm('Le texte est vide. Souhaitez-vous supprimer cette réplique ?')) {
          this.textManager.removeTextItem(textItem);
          this.render();
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

    if (btnSave) btnSave.onclick = onSave;
    if (btnCancel) btnCancel.onclick = onCancel;
    if (btnClose) btnClose.onclick = onCancel;

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
        this.vibrate(40);
        this.showToast('Réplique et repères supprimés');
      }
      this.hideContextMenu();
    });

    document.getElementById('cmenuEditText')?.addEventListener('click', () => {
      if (this.contextTarget?.hitText) {
        this.openTextEditModal(this.contextTarget.hitText);
      } else if (this.contextTarget?.phraseInfo?.textItem) {
        this.openTextEditModal(this.contextTarget.phraseInfo.textItem);
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
          this.vibrate(40);
          this.showToast('Réplique et repères supprimés');
        } else {
          this.textManager.removeSeparator(band, sep.x);
          this.render();
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
        this.vibrate(25);
        this.showToast('Repère de plan supprimé');
      }
      this.hideContextMenu();
    });

    document.getElementById('cmenuAddStart')?.addEventListener('click', () => {
      if (this.contextTarget && this.contextTarget.bandIdx >= 0) {
        const curX = this.snapWorldXToTenth(this.contextTarget.worldX);
        this.textManager.addSeparator(this.contextTarget.bandIdx, curX, SeparatorType.START);
        this.render();
        this.vibrate(25);
        this.openPromptForStart(this.contextTarget.bandIdx, curX);
      }
      this.hideContextMenu();
    });

    document.getElementById('cmenuAddEnd')?.addEventListener('click', () => {
      if (this.contextTarget && this.contextTarget.bandIdx >= 0) {
        const curX = Math.round(this.contextTarget.worldX / (this.pps * 0.1)) * (this.pps * 0.1);
        this.textManager.addSeparator(this.contextTarget.bandIdx, curX, SeparatorType.END);
        this.render();
        this.vibrate(25);
        this.showToast('Repère Fin (END) posé');
      }
      this.hideContextMenu();
    });

    document.getElementById('cmenuAddInner')?.addEventListener('click', () => {
      if (this.contextTarget && this.contextTarget.bandIdx >= 0) {
        const curX = Math.round(this.contextTarget.worldX / (this.pps * 0.1)) * (this.pps * 0.1);
        this.textManager.addSeparator(this.contextTarget.bandIdx, curX, SeparatorType.INNER);
        this.render();
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
      if (confirm('Créer un nouveau projet vierge ? Les modifications non enregistrées seront perdues.')) {
        this.textManager = new TextManager(4);
        this.render();
        this.showToast('Nouveau projet initialisé');
      }
    });

    document.getElementById('mBtnOpen')?.addEventListener('click', () => {
      closeDrawer();
      fileInputProject?.click();
    });

    document.getElementById('mBtnSave')?.addEventListener('click', () => {
      closeDrawer();
      this.exportProject();
    });

    document.getElementById('mBtnMedia')?.addEventListener('click', () => {
      closeDrawer();
      fileInputMedia?.click();
    });

    document.getElementById('mBtnExportSrt')?.addEventListener('click', () => {
      closeDrawer();
      ProjectIO.exportSrt(this.textManager, this.pps);
      this.showToast('Fichier SRT généré !');
    });

    document.getElementById('mBtnDemo')?.addEventListener('click', () => {
      closeDrawer();
      this.loadInitialDemo();
      this.showToast('Projet démo chargé');
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
      this.pps = Math.min(240, this.pps * 1.25);
      this.videoSync.pps = this.pps;
      this.render();
    });

    document.getElementById('mBtnZoomOut')?.addEventListener('click', () => {
      this.pps = Math.max(30, this.pps * 0.8);
      this.videoSync.pps = this.pps;
      this.render();
    });

    document.getElementById('mBtnHelp')?.addEventListener('click', () => {
      closeDrawer();
      document.getElementById('helpModal')?.classList.add('active');
    });
  }

  loadInitialDemo() {
    // Projet d'exemple immédiat et interactif
    this.textManager = new TextManager(4);
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
}

// Initialisation au chargement de la page
window.addEventListener('DOMContentLoaded', () => {
  window.app = new OmeRythApp();
});

