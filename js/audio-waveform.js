/**
 * OmeRyth Web - Audio Waveform Processor & Renderer
 * Décodage Web Audio API natif et affichage optimisé des formes d'ondes vocales (RMS/Peaks).
 */

export class AudioWaveform {
  constructor() {
    this.audioContext = null;
    this.peaks = null; // Float32Array de crêtes [0.0 à 1.0]
    this.duration = 0;
    this.pointsPerSecond = 50; // Résolution d'échantillonnage de la waveform
    this.isDecoding = false;
  }

  getAudioContext() {
    if (!this.audioContext) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioCtx();
    }
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }
    return this.audioContext;
  }

  async loadFromBlob(blob, onProgress = null) {
    this.isDecoding = true;
    if (onProgress) onProgress(10, 'Lecture des données audio...');

    try {
      const arrayBuffer = await blob.arrayBuffer();
      if (onProgress) onProgress(30, 'Décodage Web Audio API...');

      const ctx = this.getAudioContext();
      // Copie pour éviter le détachement de l'ArrayBuffer
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));

      if (onProgress) onProgress(70, 'Calcul des crêtes vocales...');
      this.extractPeaks(audioBuffer);

      this.duration = audioBuffer.duration;
      this.isDecoding = false;
      if (onProgress) onProgress(100, 'Waveform prête !');
      return true;
    } catch (err) {
      console.warn('Erreur de décodage audio (la vidéo continuera sans waveform) :', err);
      this.isDecoding = false;
      this.peaks = null;
      return false;
    }
  }

  extractPeaks(audioBuffer) {
    const numChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const totalSamples = audioBuffer.length;
    const duration = audioBuffer.duration;

    const totalPoints = Math.ceil(duration * this.pointsPerSecond);
    this.peaks = new Float32Array(totalPoints);

    const channelData = [];
    for (let c = 0; c < numChannels; c++) {
      channelData.push(audioBuffer.getChannelData(c));
    }

    const blockSize = Math.floor(totalSamples / totalPoints);

    for (let i = 0; i < totalPoints; i++) {
      const start = i * blockSize;
      const end = Math.min(start + blockSize, totalSamples);
      let sumSq = 0;
      let count = 0;

      for (let s = start; s < end; s += 4) { // Sous-échantillonnage par 4 pour vitesse
        for (let c = 0; c < numChannels; c++) {
          const val = channelData[c][s];
          sumSq += val * val;
          count++;
        }
      }

      const rms = count > 0 ? Math.sqrt(sumSq / count) : 0;
      // Amplification dynamique douce pour faire ressortir les répliques
      const boosted = Math.min(1.0, rms * 3.2);
      this.peaks[i] = boosted;
    }
  }

  hasData() {
    return this.peaks !== null && this.peaks.length > 0;
  }

  /**
   * Rendu graphique haute performance de la waveform sur le Canvas.
   */
  draw(ctx, offsetX, width, height, pps, currentTime, startY = 0, trackHeight = 40) {
    if (!this.hasData()) return;

    // Calcul de la fenêtre temporelle visible
    const leftTime = Math.max(0, -offsetX / pps);
    const rightTime = Math.min(this.duration, (width - offsetX) / pps);
    if (leftTime >= rightTime) return;

    const startIndex = Math.max(0, Math.floor(leftTime * this.pointsPerSecond));
    const endIndex = Math.min(this.peaks.length - 1, Math.ceil(rightTime * this.pointsPerSecond));

    ctx.save();
    ctx.fillStyle = 'rgba(78, 205, 196, 0.28)'; // Turquoise doux translucide OmeRyth
    ctx.strokeStyle = 'rgba(78, 205, 196, 0.65)';
    ctx.lineWidth = 1;

    const centerY = startY + trackHeight / 2;
    const maxHalfHeight = (trackHeight * 0.45);

    ctx.beginPath();
    let first = true;

    // Tracé supérieur
    for (let i = startIndex; i <= endIndex; i++) {
      const time = i / this.pointsPerSecond;
      const screenX = time * pps + offsetX;
      const peak = this.peaks[i];
      const barH = peak * maxHalfHeight;
      const topY = centerY - barH;

      if (first) {
        ctx.moveTo(screenX, centerY);
        first = false;
      }
      ctx.lineTo(screenX, topY);
    }

    // Tracé inférieur (symétrique)
    for (let i = endIndex; i >= startIndex; i--) {
      const time = i / this.pointsPerSecond;
      const screenX = time * pps + offsetX;
      const peak = this.peaks[i];
      const barH = peak * maxHalfHeight;
      const bottomY = centerY + barH;
      ctx.lineTo(screenX, bottomY);
    }

    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }
}
