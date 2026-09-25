/**
 * OmeRyth Web - Video & Timeline Synchronizer
 * Synchronisation milliseconde entre l'élément HTML5 Video/Audio et la bande rythmo.
 */

export class VideoSync {
  constructor(videoElement, onFrameCallback = null) {
    this.video = videoElement;
    this.onFrame = onFrameCallback;
    this.fps = 60.0;
    this.isPlaying = false;
    this.mediaDuration = 0;
    this.currentTime = 0;
    this.rafId = null;
    this.onPlayStateChange = null;

    this.initEvents();
  }

  setFps(fps) {
    const numericFps = Number(fps);
    if (!isNaN(numericFps) && numericFps > 0) {
      // Si proche de 24 IPS (cinéma, 23.976, 24), on cale à 24 IPS, sinon 60 IPS
      if (Math.abs(numericFps - 24.0) <= 0.6) {
        this.fps = 24.0;
      } else {
        this.fps = 60.0;
      }
    }
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
      if (this.onPlayStateChange) this.onPlayStateChange(true);
    });

    this.video.addEventListener('playing', () => {
      this.isPlaying = true;
      this.startLoop();
      if (this.onPlayStateChange) this.onPlayStateChange(true);
    });

    this.video.addEventListener('pause', () => {
      this.isPlaying = false;
      this.stopLoop();
      this.currentTime = this.video.currentTime;
      if (this.onPlayStateChange) this.onPlayStateChange(false);
      if (this.onFrame) this.onFrame(this.currentTime);
    });

    this.video.addEventListener('ended', () => {
      this.isPlaying = false;
      this.stopLoop();
      this.currentTime = this.video.duration;
      if (this.onPlayStateChange) this.onPlayStateChange(false);
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

    this.video.addEventListener('error', () => {
      this.isPlaying = false;
      this.stopLoop();
      if (this.onPlayStateChange) this.onPlayStateChange(false);
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
    this.isPlaying = false;
    if (this.onPlayStateChange) this.onPlayStateChange(false);
    this.video.src = srcUrl;
    this.video.load();
    this.currentTime = 0;
  }

  togglePlayPause() {
    if (this.video.paused) {
      this.video.play().catch(e => {
        console.log('Autoplay / Lecture empêchée :', e);
        this.isPlaying = false;
        if (this.onPlayStateChange) this.onPlayStateChange(false);
      });
    } else {
      this.video.pause();
    }
  }

  play() {
    if (this.video.paused) {
      this.video.play().catch(e => {
        console.log('Erreur play :', e);
        this.isPlaying = false;
        if (this.onPlayStateChange) this.onPlayStateChange(false);
      });
    }
  }

  pause() {
    if (!this.video.paused) {
      this.video.pause();
    }
  }

  seekTo(seconds) {
    const maxDur = (this.video && !isNaN(this.video.duration) && this.video.duration > 0)
      ? this.video.duration
      : 7200;
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
    const maxFrames = Math.max(1, Math.round(this.fps)) - 1;
    const frames = Math.max(0, Math.min(maxFrames, Math.floor((seconds % 1.0) * this.fps)));

    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`;
  }
}
