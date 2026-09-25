/**
 * OmeRyth Web - Video FPS Detector
 * Détection rapide du framerate vidéo (MP4, MOV, WebM, MKV) côté client
 * et adaptation automatique à 24 IPS (cinéma) ou 60 IPS (par défaut).
 */

export class VideoFpsDetector {
  /**
   * Analyse le fichier vidéo pour déterminer son framerate.
   * Règle utilisateur : si la vidéo est à ~24 IPS (ex: 23.976 ou 24), on applique 24 IPS, sinon 60 IPS.
   * @param {File} file
   * @param {HTMLVideoElement} videoElement
   * @returns {Promise<number>} 24.0 ou 60.0
   */
  static async detectTargetFps(file, videoElement = null) {
    try {
      const detected = await this.probeContainerFps(file);
      if (detected && detected > 0) {
        return this.normalizeTargetFps(detected);
      }
    } catch (e) {
      console.warn('Erreur lors du sondage binaire du framerate :', e);
    }

    // Si le conteneur ne donne pas de résultat, tenter via requestVideoFrameCallback si disponible
    if (videoElement && typeof videoElement.requestVideoFrameCallback === 'function') {
      this.probeRuntimeFps(videoElement).catch(() => {});
    }

    // Par défaut : 60 IPS
    return 60.0;
  }

  /**
   * Normalise un framerate brut selon la règle :
   * ~24 IPS (23.5 à 24.5) -> 24.0
   * Autrement -> 60.0
   */
  static normalizeTargetFps(rawFps) {
    if (typeof rawFps !== 'number' || isNaN(rawFps) || rawFps <= 0) {
      return 60.0;
    }
    if (Math.abs(rawFps - 24.0) <= 0.6) {
      return 24.0;
    }
    return 60.0;
  }

  /**
   * Sondage binaire rapide des premiers et derniers mégaoctets du fichier
   */
  static async probeContainerFps(file) {
    if (!file || file.size < 64) return null;

    const nameLower = (file.name || '').toLowerCase();

    // 1. Fichiers MP4 / MOV / M4V
    if (nameLower.endsWith('.mp4') || nameLower.endsWith('.mov') || nameLower.endsWith('.m4v') || (file.type && file.type.includes('mp4'))) {
      const fps = await this.probeMp4Fps(file);
      if (fps) return fps;
    }

    // 2. Fichiers WebM / MKV
    if (nameLower.endsWith('.webm') || nameLower.endsWith('.mkv') || (file.type && file.type.includes('webm'))) {
      const fps = await this.probeWebmFps(file);
      if (fps) return fps;
    }

    return null;
  }

  /**
   * Extraction du framerate pour les fichiers MP4/MOV via les boîtes moov/mdia/mdhd et stts
   */
  static async probeMp4Fps(file) {
    // 1. Lire le premier mégaoctet (si moov est au début)
    const headSize = Math.min(file.size, 1024 * 1024);
    const headBuf = await file.slice(0, headSize).arrayBuffer();
    let fps = this.extractMp4FpsFromBuffer(new DataView(headBuf));
    if (fps) return fps;

    // 2. Si moov est à la fin du fichier (très fréquent sur MP4 non fast-start)
    if (file.size > headSize) {
      const tailSize = Math.min(file.size, 2 * 1024 * 1024);
      const tailBuf = await file.slice(file.size - tailSize, file.size).arrayBuffer();
      fps = this.extractMp4FpsFromBuffer(new DataView(tailBuf));
      if (fps) return fps;
    }

    return null;
  }

  static extractMp4FpsFromBuffer(view) {
    try {
      const len = view.byteLength;
      let pos = 0;

      const findBox = (start, end, targetType) => {
        let p = start;
        while (p + 8 <= end) {
          const size = view.getUint32(p);
          const type = String.fromCharCode(
            view.getUint8(p + 4),
            view.getUint8(p + 5),
            view.getUint8(p + 6),
            view.getUint8(p + 7)
          );
          const boxSize = size === 1 ? Number(view.getBigUint64(p + 8)) : size;
          const boxEnd = boxSize === 0 ? end : p + boxSize;
          if (type === targetType) {
            return { pos: p, boxEnd, dataStart: p + (size === 1 ? 16 : 8) };
          }
          if (boxSize <= 0) break;
          p = boxEnd;
        }
        return null;
      };

      // Recherche de 'moov' n'importe où dans le tampon
      let moov = null;
      for (let i = 0; i <= len - 8; i += 4) {
        const type = String.fromCharCode(
          view.getUint8(i + 4),
          view.getUint8(i + 5),
          view.getUint8(i + 6),
          view.getUint8(i + 7)
        );
        if (type === 'moov') {
          const size = view.getUint32(i);
          const boxSize = size === 1 ? Number(view.getBigUint64(i + 8)) : size;
          moov = { pos: i, boxEnd: boxSize === 0 ? len : Math.min(len, i + boxSize), dataStart: i + (size === 1 ? 16 : 8) };
          break;
        }
      }
      if (!moov) return null;

      // Parcourir les boîtes 'trak' à l'intérieur de 'moov'
      let trakPos = moov.dataStart;
      while (trakPos < moov.boxEnd) {
        const trak = findBox(trakPos, moov.boxEnd, 'trak');
        if (!trak) break;
        trakPos = trak.boxEnd;

        const mdia = findBox(trak.dataStart, trak.boxEnd, 'mdia');
        if (!mdia) continue;

        // Vérifier si c'est une piste vidéo ('vide')
        const hdlr = findBox(mdia.dataStart, mdia.boxEnd, 'hdlr');
        if (hdlr && hdlr.dataStart + 12 <= mdia.boxEnd) {
          const hType = String.fromCharCode(
            view.getUint8(hdlr.dataStart + 8),
            view.getUint8(hdlr.dataStart + 9),
            view.getUint8(hdlr.dataStart + 10),
            view.getUint8(hdlr.dataStart + 11)
          );
          if (hType !== 'vide') continue;
        }

        // mdhd (timescale)
        const mdhd = findBox(mdia.dataStart, mdia.boxEnd, 'mdhd');
        if (!mdhd) continue;
        const mdhdVer = view.getUint8(mdhd.dataStart);
        const timescale = mdhdVer === 1
          ? view.getUint32(mdhd.dataStart + 20)
          : view.getUint32(mdhd.dataStart + 12);

        // stbl / stts (time-to-sample)
        const minf = findBox(mdia.dataStart, mdia.boxEnd, 'minf');
        if (!minf) continue;
        const stbl = findBox(minf.dataStart, minf.boxEnd, 'stbl');
        if (!stbl) continue;
        const stts = findBox(stbl.dataStart, stbl.boxEnd, 'stts');
        if (!stts) continue;

        const entryCount = view.getUint32(stts.dataStart + 4);
        if (entryCount > 0 && timescale > 0) {
          const sampleDelta = view.getUint32(stts.dataStart + 12);
          if (sampleDelta > 0) {
            const calculatedFps = timescale / sampleDelta;
            if (calculatedFps >= 10 && calculatedFps <= 144) {
              return calculatedFps;
            }
          }
        }
      }
    } catch (_) {}
    return null;
  }

  /**
   * Extraction du framerate pour les fichiers WebM / MKV (EBML DefaultDuration)
   */
  static async probeWebmFps(file) {
    try {
      const sliceSize = Math.min(file.size, 256 * 1024);
      const buf = await file.slice(0, sliceSize).arrayBuffer();
      const bytes = new Uint8Array(buf);

      // Chercher l'ID EBML 0x23E383 (DefaultDuration)
      for (let i = 0; i < bytes.length - 8; i++) {
        if (bytes[i] === 0x23 && bytes[i + 1] === 0xE3 && bytes[i + 2] === 0x83) {
          const sizeByte = bytes[i + 3];
          const dataLen = sizeByte & 0x0F; // Longueur de la valeur
          if (dataLen >= 4 && dataLen <= 8) {
            let val = 0;
            for (let j = 0; j < dataLen; j++) {
              val = (val * 256) + bytes[i + 4 + j];
            }
            if (val > 0) {
              const fps = 1000000000 / val;
              if (fps >= 10 && fps <= 144) {
                return fps;
              }
            }
          }
        }
      }
    } catch (_) {}
    return null;
  }

  /**
   * Mesure dynamique lors de la première lecture via requestVideoFrameCallback
   */
  static probeRuntimeFps(videoElement) {
    return new Promise((resolve) => {
      if (!videoElement || typeof videoElement.requestVideoFrameCallback !== 'function') {
        resolve(null);
        return;
      }

      let lastTime = null;
      let frameCount = 0;
      let samples = [];

      const callback = (now, metadata) => {
        const time = metadata.expectedDisplayTime || metadata.presentationTime || now;
        if (lastTime !== null) {
          const delta = (time - lastTime) / 1000.0;
          if (delta > 0.005 && delta < 0.2) {
            samples.push(1.0 / delta);
            frameCount++;
          }
        }
        lastTime = time;

        if (frameCount < 4) {
          videoElement.requestVideoFrameCallback(callback);
        } else {
          // Moyenne des échantillons
          const avgFps = samples.reduce((a, b) => a + b, 0) / samples.length;
          resolve(avgFps);
        }
      };

      videoElement.requestVideoFrameCallback(callback);
      setTimeout(() => resolve(null), 1000);
    });
  }
}
