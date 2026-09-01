/* global window */
(function defineAudio(global) {
  "use strict";

  const clampVolume = (volume) => Math.min(1, Math.max(0, volume));
  const HTML_POOL_SIZE = 3;

  const HTML_FILES = Object.freeze({
    start: "assets/audio/start.wav",
    jump: "assets/audio/jump.wav",
    spring: "assets/audio/spring.wav",
    pickup: "assets/audio/pickup.wav",
    medal: "assets/audio/medal.wav",
    shield: "assets/audio/shield.wav",
    shieldHit: "assets/audio/shield-hit.wav",
    shot: "assets/audio/shot.wav",
    hit: "assets/audio/hit.wav",
    break: "assets/audio/break.wav",
    death: "assets/audio/death.wav",
    swordStart: "assets/audio/sword-start.wav",
  });

  class ZhuyaAudio {
    constructor() {
      this.context = null;
      this.enabled = true;
      this.buffers = new Map();
      this.loops = new Map();
      this.buffersPrepared = false;
      this.fileBuffersPromise = null;
      this.htmlTemplates = new Map();
      this.htmlPools = new Map();
      this.htmlPoolIndexes = new Map();
      this.htmlUnlocked = false;
      this.htmlUnlockPromise = null;
      this.htmlStartGestureAttempted = false;
      this.htmlStartPrimed = false;
      this.webUnlockPromise = null;
      this.webUnlockPending = false;
      this.backend = "web";
      const userAgent = window.navigator?.userAgent || "";
      const touchMac = /Macintosh/.test(userAgent) && (window.navigator?.maxTouchPoints || 0) > 1;
      const coarsePointer = window.matchMedia?.("(pointer: coarse)")?.matches || false;
      const forceHtmlAudio = new URLSearchParams(window.location.search).has("html-audio");
      this.mobileMediaMode = forceHtmlAudio || /iPhone|iPad|iPod|Android|Mobile/i.test(userAgent) || touchMac || coarsePointer;
      this.prepareHtmlAudio();
      this.handleGlobalGesture = () => this.resumeFromGesture();
      window.addEventListener("pointerdown", this.handleGlobalGesture, { capture: true, passive: true });
      window.addEventListener("touchstart", this.handleGlobalGesture, { capture: true, passive: true });
      window.addEventListener("touchend", this.handleGlobalGesture, { capture: true, passive: true });
      window.addEventListener("click", this.handleGlobalGesture, { capture: true, passive: true });
      window.addEventListener("keydown", this.handleGlobalGesture, { capture: true, passive: true });
    }

    prepareHtmlAudio() {
      for (const [name, path] of Object.entries(HTML_FILES)) {
        const pool = [];
        for (let index = 0; index < HTML_POOL_SIZE; index += 1) {
          const media = new Audio(path);
          media.preload = "auto";
          media.setAttribute("playsinline", "");
          media.setAttribute("webkit-playsinline", "");
          media.load();
          pool.push(media);
        }
        this.htmlTemplates.set(name, pool[0]);
        this.htmlPools.set(name, pool);
        this.htmlPoolIndexes.set(name, 0);
      }
    }

    primeFromGesture(force = false) {
      if (!this.mobileMediaMode && !force) return false;
      this.playStartFromGesture();
      if (window.AudioContext || window.webkitAudioContext) {
        this.beginWebAudioUnlock();
        return true;
      }
      return this.primeHtmlPoolsFromGesture();
    }

    playStartFromGesture() {
      if (this.htmlStartGestureAttempted) return;
      this.htmlStartGestureAttempted = true;
      const media = this.htmlPools.get("start")?.[0];
      if (!media) return;
      try {
        media.currentTime = 0;
        media.muted = false;
        media.volume = 0.2;
        this.htmlStartPrimed = true;
        const playback = media.play();
        this.htmlUnlocked = true;
        this.htmlUnlockPromise = Promise.resolve(true);
        if (playback?.catch) {
          playback.catch(() => {
            this.htmlStartPrimed = false;
            this.htmlUnlocked = false;
            this.htmlUnlockPromise = null;
            if (this.context?.state !== "running") this.backend = "web";
          });
        }
      } catch {
        this.htmlStartPrimed = false;
        this.htmlUnlocked = false;
        this.htmlUnlockPromise = null;
      }
    }

    primeHtmlPoolsFromGesture() {
      if (this.htmlUnlocked || this.htmlUnlockPromise) return true;
      const primeTasks = [];
      for (const pool of this.htmlPools.values()) {
        for (const media of pool) primeTasks.push(this.primeHtmlMedia(media));
      }
      if (!primeTasks.length) return false;
      const pending = Promise.all(primeTasks).then((results) => {
        this.htmlUnlocked = results.every(Boolean);
        if (this.htmlUnlocked) this.backend = "html";
        if (!this.htmlUnlocked && this.htmlUnlockPromise === pending) this.htmlUnlockPromise = null;
        return this.htmlUnlocked;
      });
      this.htmlUnlockPromise = pending;
      return true;
    }

    primeHtmlMedia(media) {
      try {
        media.muted = true;
        media.volume = 0;
        media.currentTime = 0;
        const playback = media.play();
        let timeoutId = 0;
        const accepted = Promise.resolve(playback).then(() => true, () => false);
        const timeout = new Promise((resolve) => {
          timeoutId = window.setTimeout(() => resolve(false), 800);
        });
        return Promise.race([accepted, timeout])
          .then((ready) => {
            window.clearTimeout(timeoutId);
            try {
              media.pause();
              media.currentTime = 0;
              media.muted = false;
              media.volume = 1;
            } catch {
              return false;
            }
            return ready;
          });
      } catch {
        try {
          media.pause();
          media.currentTime = 0;
          media.muted = false;
          media.volume = 1;
        } catch {
          // The WebAudio path remains available if this media element cannot be primed.
        }
        return Promise.resolve(false);
      }
    }

    resumeFromGesture() {
      if (!this.enabled || !this.mobileMediaMode) return;
      if (!this.htmlUnlocked && !this.htmlUnlockPromise) this.primeFromGesture();
      if (this.context && this.context.state !== "running") {
        try {
          const resumed = this.context.resume();
          Promise.resolve(resumed)
            .then(() => {
              if (this.context?.state === "running") this.backend = "web";
            })
            .catch(() => {});
        } catch {
          // A later ordinary gesture will retry the same AudioContext.
        }
      }
      if (!this.context || this.context.state !== "running") this.beginWebAudioUnlock();
    }

    async unlock() {
      if (this.mobileMediaMode && !this.htmlUnlocked) {
        if (!this.htmlUnlockPromise) this.primeFromGesture();
      }
      const htmlPromise = this.htmlUnlockPromise || Promise.resolve(this.htmlUnlocked);
      const webPromise = this.beginWebAudioUnlock();
      const [htmlReady, webReady] = await Promise.all([htmlPromise, webPromise]);
      if (webReady) this.backend = "web";
      else if (htmlReady) this.backend = "html";
      return htmlReady || webReady;
    }

    beginWebAudioUnlock() {
      if (this.webUnlockPending) return this.webUnlockPromise;
      if (this.webUnlockPromise && this.context?.state === "running") return this.webUnlockPromise;
      this.webUnlockPending = true;
      const pending = Promise.resolve(this.unlockWebAudio())
        .then((ready) => {
          if (!ready) this.webUnlockPromise = null;
          return ready;
        }, () => {
          this.webUnlockPromise = null;
          return false;
        })
        .finally(() => {
          this.webUnlockPending = false;
        });
      this.webUnlockPromise = pending;
      return pending;
    }

    async unlockWebAudio() {
      if (!this.context) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return false;
        try {
          this.context = new AudioContext({ latencyHint: "interactive" });
        } catch {
          this.context = new AudioContext();
        }
        this.prepareBuffers();
      }
      try {
        const silent = this.context.createBufferSource();
        silent.buffer = this.context.createBuffer(1, 1, this.context.sampleRate);
        silent.connect(this.context.destination);
        silent.start(0);
        if (this.context.state !== "running") {
          await Promise.race([
            this.context.resume().catch(() => false),
            new Promise((resolve) => window.setTimeout(() => resolve(false), 600)),
          ]);
        }
        this.prepareFileBuffers().catch(() => {});
      } catch {
        return false;
      }
      return this.context.state === "running";
    }

    isReady() {
      if (this.backend === "html" && this.htmlUnlocked) return true;
      return Boolean(this.context && this.context.state === "running");
    }

    prepareBuffers() {
      if (this.buffersPrepared || !this.context) return;
      this.buffersPrepared = true;
      const tone = (name, frequency, duration, decay = 5, secondFrequency = null) => {
        const sampleRate = this.context.sampleRate;
        const buffer = this.context.createBuffer(1, Math.ceil(sampleRate * duration), sampleRate);
        const data = buffer.getChannelData(0);
        for (let index = 0; index < data.length; index += 1) {
          const time = index / sampleRate;
          const progress = time / duration;
          const currentFrequency = secondFrequency
            ? frequency + (secondFrequency - frequency) * progress
            : frequency;
          const envelope = Math.exp(-decay * progress) * (1 - progress);
          data[index] = Math.sin(Math.PI * 2 * currentFrequency * time) * envelope * 0.55;
        }
        this.buffers.set(name, buffer);
      };
      tone("jump", 255, 0.09, 5, 315);
      tone("spring", 180, 0.18, 3.2, 620);
      tone("pickup", 620, 0.12, 4, 980);
      tone("medal", 920, 0.11, 4, 1280);
      tone("shield", 390, 0.16, 3.2, 710);
      tone("shieldHit", 220, 0.18, 5, 90);
      tone("shot", 720, 0.055, 6, 980);
      tone("hit", 150, 0.13, 5, 70);
      tone("break", 145, 0.15, 5, 55);
      tone("death", 270, 0.38, 2.6, 72);
      tone("start", 460, 0.18, 3.2, 840);
      tone("swordStart", 430, 0.24, 2.4, 920);
    }

    decodeAudioBuffer(arrayBuffer) {
      return new Promise((resolve, reject) => {
        let settled = false;
        const complete = (buffer) => {
          if (settled) return;
          settled = true;
          resolve(buffer);
        };
        const fail = (error) => {
          if (settled) return;
          settled = true;
          reject(error);
        };
        try {
          const result = this.context.decodeAudioData(arrayBuffer.slice(0), complete, fail);
          if (result?.then) result.then(complete, fail);
        } catch (error) {
          fail(error);
        }
      });
    }

    prepareFileBuffers() {
      if (!this.context) return Promise.resolve(false);
      if (this.fileBuffersPromise) return this.fileBuffersPromise;
      this.fileBuffersPromise = Promise.allSettled(
        Object.entries(HTML_FILES).map(async ([name, path]) => {
          const response = await fetch(path, { cache: "force-cache" });
          if (!response.ok) throw new Error(`Unable to load audio: ${path}`);
          const buffer = await this.decodeAudioBuffer(await response.arrayBuffer());
          this.buffers.set(name, buffer);
        }),
      ).then((results) => results.some((result) => result.status === "fulfilled"));
      return this.fileBuffersPromise;
    }

    play(name, volume = 0.18) {
      if (!this.enabled) return;
      if (name === "start" && this.htmlStartPrimed) {
        this.htmlStartPrimed = false;
        return;
      }
      if (this.backend === "web") {
        this.fallbackToWebAudio(name, volume);
        return;
      }
      if (this.backend === "html" && this.htmlUnlocked) {
        this.playHtml(name, volume);
        return;
      }
      this.fallbackToWebAudio(name, volume);
    }

    playHtml(name, volume) {
      const pool = this.htmlPools.get(name);
      if (!pool?.length) {
        this.fallbackToWebAudio(name, volume);
        return;
      }

      const startIndex = this.htmlPoolIndexes.get(name) || 0;
      let selectedIndex = startIndex;
      for (let offset = 0; offset < pool.length; offset += 1) {
        const candidateIndex = (startIndex + offset) % pool.length;
        if (pool[candidateIndex].paused || pool[candidateIndex].ended) {
          selectedIndex = candidateIndex;
          break;
        }
      }
      this.htmlPoolIndexes.set(name, (selectedIndex + 1) % pool.length);

      const media = pool[selectedIndex];
      try {
        media.currentTime = 0;
        media.muted = false;
        media.volume = clampVolume(volume);
        const playback = media.play();
        if (playback?.catch) playback.catch(() => this.fallbackToWebAudio(name, volume));
      } catch {
        this.fallbackToWebAudio(name, volume);
      }
    }

    fallbackToWebAudio(name, volume) {
      if (this.playWebAudio(name, volume)) return;
      Promise.resolve(this.beginWebAudioUnlock())
        .then((ready) => {
          if (ready) this.playWebAudio(name, volume);
        })
        .catch(() => {});
    }

    playWebAudio(name, volume) {
      if (!this.context || this.context.state !== "running") return false;
      const buffer = this.buffers.get(name);
      if (!buffer) return false;
      const source = this.context.createBufferSource();
      const gain = this.context.createGain();
      source.buffer = buffer;
      gain.gain.value = clampVolume(volume);
      source.connect(gain).connect(this.context.destination);
      source.start();
      return true;
    }

    startLoop(name, volume = 0.045) {
      if (!this.enabled || this.loops.has(name)) return;
      if (this.backend === "html" && this.htmlUnlocked) {
        this.startHtmlLoop(name, volume);
        return;
      }
      this.startWebAudioLoop(name, volume);
    }

    startHtmlLoop(name, volume) {
      const template = this.htmlTemplates.get(`${name}Loop`);
      if (!template) return;
      const media = template.cloneNode(true);
      const targetVolume = clampVolume(volume);
      media.loop = true;
      media.volume = 0.01;
      media.setAttribute("playsinline", "");
      const loop = { mode: "html", media, fadeToken: 0 };
      this.loops.set(name, loop);
      const playback = media.play();
      if (playback?.catch) {
        playback.catch(() => {
          if (this.loops.get(name) !== loop) return;
          this.loops.delete(name);
          this.startWebAudioLoop(name, volume);
        });
      }
      this.fadeHtmlLoop(loop, targetVolume, 0.18);
    }

    startWebAudioLoop(name, volume) {
      if (!this.context || this.context.state !== "running" || this.loops.has(name)) return;
      const buffer = this.buffers.get(`${name}Loop`) || this.buffers.get(`${name}Air`);
      if (!buffer) return;
      const source = this.context.createBufferSource();
      const gain = this.context.createGain();
      source.buffer = buffer;
      source.loop = true;
      gain.gain.setValueAtTime(0.0001, this.context.currentTime);
      gain.gain.exponentialRampToValueAtTime(
        Math.max(clampVolume(volume), 0.0001),
        this.context.currentTime + 0.18,
      );
      source.connect(gain).connect(this.context.destination);
      source.start();
      this.loops.set(name, { mode: "web", source, gain });
    }

    fadeHtmlLoop(loop, targetVolume, duration, onComplete = null) {
      loop.fadeToken += 1;
      const token = loop.fadeToken;
      const startVolume = loop.media.volume;
      const startedAt = window.performance.now();
      const tick = (timestamp) => {
        if (loop.fadeToken !== token) return;
        const progress = Math.min(1, (timestamp - startedAt) / Math.max(1, duration * 1000));
        loop.media.volume = startVolume + (targetVolume - startVolume) * progress;
        if (progress < 1) window.requestAnimationFrame(tick);
        else onComplete?.();
      };
      window.requestAnimationFrame(tick);
    }

    stopLoop(name, fade = 0.18) {
      const loop = this.loops.get(name);
      if (!loop) return;
      this.loops.delete(name);
      if (loop.mode === "html") {
        this.fadeHtmlLoop(loop, 0, fade, () => {
          loop.media.pause();
          loop.media.currentTime = 0;
        });
        return;
      }
      if (!this.context) return;
      const now = this.context.currentTime;
      loop.gain.gain.cancelScheduledValues(now);
      loop.gain.gain.setValueAtTime(Math.max(loop.gain.gain.value, 0.0001), now);
      loop.gain.gain.exponentialRampToValueAtTime(0.0001, now + fade);
      loop.source.stop(now + fade + 0.02);
    }

    stopAllLoops() {
      for (const name of this.loops.keys()) this.stopLoop(name, 0.12);
    }

    setEnabled(enabled) {
      this.enabled = Boolean(enabled);
      if (!this.enabled) this.stopAllLoops();
    }
  }

  global.ZhuyaAudio = ZhuyaAudio;
})(window);

