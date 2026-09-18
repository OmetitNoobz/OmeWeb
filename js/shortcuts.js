/**
 * OmeRyth Web - Keyboard Shortcuts Manager
 * Reproduction fidèle des raccourcis clavier OmeRyth Desktop.
 */

export class ShortcutsManager {
  constructor(app) {
    this.app = app;
    this.enabled = true;
    this.initListeners();
  }

  initListeners() {
    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;

      // Ne pas intercepter les touches si l'utilisateur écrit dans un champ texte (input, textarea)
      const targetTag = e.target.tagName.toLowerCase();
      if (targetTag === 'input' || targetTag === 'textarea' || e.target.isContentEditable) {
        if (e.key === 'Escape') {
          e.target.blur();
        }
        return;
      }

      // Ctrl+Z (Undo)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        this.app.undo();
        return;
      }

      // Ctrl+Y ou Ctrl+Shift+Z (Redo)
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
        e.preventDefault();
        this.app.redo();
        return;
      }

      // Ctrl+S (Sauvegarder)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        this.app.exportProject();
        return;
      }

      // Ctrl+W (Basculer Waveform)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        this.app.toggleWaveform();
        return;
      }

      // Espace : Lecture / Pause
      if (e.code === 'Space') {
        e.preventDefault();
        this.app.togglePlayPause();
        return;
      }

      // Flèche gauche / droite (+/- 0.1s par défaut, +/- 0.5s avec Alt, Image par image avec Shift)
      if (e.code === 'ArrowLeft') {
        e.preventDefault();
        if (e.shiftKey) {
          this.app.videoSync.stepFrame(-1);
        } else if (e.altKey) {
          this.app.videoSync.seekDelta(-0.5);
        } else {
          this.app.videoSync.seekDelta(-0.1);
        }
        this.app.render();
        return;
      }

      if (e.code === 'ArrowRight') {
        e.preventDefault();
        if (e.shiftKey) {
          this.app.videoSync.stepFrame(1);
        } else if (e.altKey) {
          this.app.videoSync.seekDelta(0.5);
        } else {
          this.app.videoSync.seekDelta(0.1);
        }
        this.app.render();
        return;
      }

      // Pavé numérique 1 : Repère de plan à la timeline
      if (e.code === 'Numpad1' || (e.key === '1' && e.location === 3)) {
        e.preventDefault();
        this.app.addPlanMarkerAtCursor();
        return;
      }

      // Pavé numérique 2 : Signe FVR (Dentale F, V, R)
      if (e.code === 'Numpad2' || (e.key === '2' && e.location === 3)) {
        e.preventDefault();
        this.app.addSignAtCursor('FVR');
        return;
      }

      // Pavé numérique 3 : Signe NEUTRAL (Consonne neutre)
      if (e.code === 'Numpad3' || (e.key === '3' && e.location === 3)) {
        e.preventDefault();
        this.app.addSignAtCursor('NEUTRAL');
        return;
      }

      // Pavé numérique 5 : Signe OPEN_A (Grande ouverture A)
      if (e.code === 'Numpad5' || (e.key === '5' && e.location === 3)) {
        e.preventDefault();
        this.app.addSignAtCursor('OPEN_A');
        return;
      }

      // Pavé numérique 8 : Signe MPB (Labiale M, P, B)
      if (e.code === 'Numpad8' || (e.key === '8' && e.location === 3)) {
        e.preventDefault();
        this.app.addSignAtCursor('MPB');
        return;
      }

      // Touche S ou Numpad 7 : Séparateur START (ouvre la demande de rôle & texte)
      if ((e.key.toLowerCase() === 's' && !e.ctrlKey && !e.metaKey) || e.code === 'Numpad7' || (e.key === '7' && e.location === 3)) {
        e.preventDefault();
        this.app.addSeparatorAtCursor('START');
        return;
      }

      // Touche E ou Numpad 9 : Séparateur END
      if ((e.key.toLowerCase() === 'e' && !e.ctrlKey && !e.metaKey) || e.code === 'Numpad9' || (e.key === '9' && e.location === 3)) {
        e.preventDefault();
        this.app.addSeparatorAtCursor('END');
        return;
      }

      // Touche I : Séparateur INNER
      if (e.key.toLowerCase() === 'i') {
        e.preventDefault();
        this.app.addSeparatorAtCursor('INNER');
        return;
      }

      // J / K / L (Transport standard de doublage / montage)
      if (e.key.toLowerCase() === 'j') {
        e.preventDefault();
        this.app.videoSync.seekDelta(-1.0);
        this.app.render();
      } else if (e.key.toLowerCase() === 'k') {
        e.preventDefault();
        this.app.videoSync.pause();
        this.app.render();
      } else if (e.key.toLowerCase() === 'l') {
        e.preventDefault();
        this.app.videoSync.seekDelta(1.0);
        this.app.render();
      }

      // Suppr / Backspace : Supprimer sélection
      if (e.key === 'Delete' || e.key === 'Backspace') {
        this.app.deleteSelection();
      }
    });
  }
}
