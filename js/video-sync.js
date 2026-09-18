/**
 * OmeRyth Web - Video & Timeline Synchronizer
 * Synchronisation milliseconde entre l'élément HTML5 Video/Audio et la bande rythmo.
 */

export class VideoSync {
  constructor(videoElement, onFrameCallback = null) {
    this.video = videoElement;
    this.onFrame = onFrameCallback;
    this.fps = 24.0;
    this.isPlaying = false;
    this.mediaDuration = 0;
    this.currentTime = 0;
    this.rafId = null;

    this.initEvents();
  }

  initEvents() {
    this.video.addEventListener('loadedmetadata', () => {
      this.mediaDuration = this.video.duration || 0;
      this.currentTime = this.video.currentTime || 0;
      if (this.onFrame) this.onFrame(this.currentTime);
    });

    this.video.addEventListener('play', () => {
      this.isPlaying = true;
      this.startLoop();
    });

    this.video.addEventListener('pause', () => {
      this.isPlaying = false;
      this.stopLoop();
      this.currentTime = this.video.currentTime;
      if (this.onFrame) this.onFrame(this.currentTime);
    });

    this.video.addEventListener('ended', () => {
      this.isPlaying = false;
      this.stopLoop();
      this.currentTime = this.video.duration;
      if (this.onFrame) this.onFrame(this.currentTime);
    });

    this.video.addEventListener('seeking', () => {
      this.currentTime = this.video.currentTime;
      if (this.onFrame) this.onFrame(this.currentTime);
    });

    this.video.addEventListener('seeked', () => {
      this.currentTime = this.video.currentTime;
      if (this.onFrame) this.onFrame(this.currentTime);
    });
  }

  startLoop() {
    this.stopLoop();
    const tick = () => {
      if (this.isPlaying) {
        this.currentTime = this.video.currentTime;
        if (this.onFrame) this.onFrame(this.currentTime);
        this.rafId = requestAnimationFrame(tick);
      }
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stopLoop() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  loadSource(srcUrl) {
    this.stopLoop();
    this.video.src = srcUrl;
    this.video.load();
  }

  togglePlayPause() {
    if (this.video.paused) {
      this.video.play().catch(e => console.log('Autoplay empêché :', e));
    } else {
      this.video.pause();
    }
  }

  play() {
    if (this.video.paused) {
      this.video.play().catch(e => console.log('Erreur play :', e));
    }
  }

  pause() {
    if (!this.video.paused) {
      this.video.pause();
    }
  }

  seekTo(seconds) {
    const maxDur = this.video.duration || 7200;
    const clamped = Math.max(0, Math.min(seconds, maxDur));
    this.video.currentTime = clamped;
    this.currentTime = clamped;
    if (this.onFrame) this.onFrame(this.currentTime);
  }

  seekDelta(deltaSeconds) {
    this.seekTo(this.currentTime + deltaSeconds);
  }

  stepFrame(deltaFrames) {
    const frameDur = 1.0 / this.fps;
    this.pause();
    this.seekTo(this.currentTime + deltaFrames * frameDur);
  }

  setRate(rate) {
    this.video.playbackRate = Math.max(0.25, Math.min(rate, 3.0));
  }

  setVolume(vol) {
    // vol entre 0 et 100
    this.video.volume = Math.max(0, Math.min(100, vol)) / 100;
  }

  formatTimecode(seconds) {
    if (isNaN(seconds) || seconds < 0) seconds = 0;
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const frames = Math.floor((seconds % 1.0) * this.fps);

    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`;
  }
}
