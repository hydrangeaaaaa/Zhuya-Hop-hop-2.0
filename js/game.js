/* global window, ZHUYA_CONFIG, ZHUYA_CHARACTERS, ZHUYA_ASSETS */
(function defineGame(global) {
  "use strict";

  const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
  const lerp = (from, to, amount) => from + (to - from) * amount;
  const randomBetween = (minimum, maximum) => minimum + Math.random() * (maximum - minimum);
  const easeInOut = (value) => {
    const t = clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
  };
  const moveTowards = (value, target, maximumDelta) => {
    if (Math.abs(target - value) <= maximumDelta) return target;
    return value + Math.sign(target - value) * maximumDelta;
  };
  const rectsOverlap = (leftA, bottomA, widthA, heightA, leftB, bottomB, widthB, heightB) =>
    leftA < leftB + widthB &&
    leftA + widthA > leftB &&
    bottomA < bottomB + heightB &&
    bottomA + heightA > bottomB;
  const compactWorldList = (items, cutoff, dropConsumed = true) => {
    let writeIndex = 0;
    for (let readIndex = 0; readIndex < items.length; readIndex += 1) {
      const item = items[readIndex];
      if (item.y <= cutoff || (dropConsumed && item.consumed)) continue;
      items[writeIndex] = item;
      writeIndex += 1;
    }
    items.length = writeIndex;
  };
  const compactTimedList = (items) => {
    let writeIndex = 0;
    for (let readIndex = 0; readIndex < items.length; readIndex += 1) {
      const item = items[readIndex];
      if (item.elapsed >= item.duration) continue;
      items[writeIndex] = item;
      writeIndex += 1;
    }
    items.length = writeIndex;
  };

  class ZhuyaGame {
    constructor(canvas, options = {}) {
      this.canvas = canvas;
      this.context = canvas.getContext("2d", { alpha: false });
      this.stage = canvas.parentElement;
      this.audio = options.audio;
      this.onScore = options.onScore || (() => {});
      this.onGameOver = options.onGameOver || (() => {});
      this.onControlMode = options.onControlMode || (() => {});
      this.config = ZHUYA_CONFIG;
      this.selectedCharacter = "character1";
      this.characterProfile = ZHUYA_CHARACTERS[this.selectedCharacter];
      this.images = {};
      this.renderImageCache = new WeakMap();
      this.cachedRenderAssetCount = 0;
      this.backgroundPattern = null;
      this.assetsReady = false;
      const searchParameters = new URLSearchParams(window.location.search);
      this.debugEnabled = searchParameters.has("debug") ||
        searchParameters.has("smoke") ||
        searchParameters.has("perf");
      this.logicalHeight = this.config.minLogicalHeight;
      this.running = false;
      this.loopStarted = false;
      this.accumulator = 0;
      this.lastTimestamp = performance.now();
      this.lastScoreSent = -1;
      this.entityId = 1;
      this.renderCameraY = 0;
      this.canvasCssWidth = 0;
      this.canvasCssHeight = 0;
      this.canvasPixelScale = 1;
      this.lastDebugSnapshotAt = -Infinity;
      this.debugFrameStats = {
        frameDelta: 0,
        fixedSteps: 0,
        maximumFixedSteps: 0,
      };
      this.debugFrameTimes = this.debugEnabled ? new Float32Array(600) : null;
      this.debugFrameTimeCount = 0;
      this.debugFrameTimeCursor = 0;
      this.input = {
        left: false,
        right: false,
        shoot: false,
        pointers: new Map(),
      };
      this.tilt = {
        permission: false,
        received: false,
        baseline: null,
        filtered: 0,
      };
      this.boundFrame = (timestamp) => this.frame(timestamp);
      this.bindGlobalListeners();
      this.fitCanvas();
    }

    async load() {
      if (this.assetsReady) return;
      const paths = {
        background: ZHUYA_ASSETS.background,
        platformWhite: ZHUYA_ASSETS.platforms.white,
        platformBrown: ZHUYA_ASSETS.platforms.brown,
        platformYellow: ZHUYA_ASSETS.platforms.yellow,
        platformBroken: ZHUYA_ASSETS.platforms.broken,
        propellerCat: ZHUYA_ASSETS.pickups.propellerCat,
        propellerDog: ZHUYA_ASSETS.pickups.propellerDog,
        medal: ZHUYA_ASSETS.pickups.medal,
        enemyCrab: ZHUYA_ASSETS.enemies.crab,
        enemyLobster: ZHUYA_ASSETS.enemies.lobster,
        enemySpider: ZHUYA_ASSETS.enemies.spider,
        shieldAxes: ZHUYA_ASSETS.shields.axes,
        shieldBuns: ZHUYA_ASSETS.shields.buns,
        sword: ZHUYA_ASSETS.sword,
      };
      for (const [characterId, character] of Object.entries(ZHUYA_CHARACTERS)) {
        paths[`${characterId}Normal`] = character.normal;
        paths[`${characterId}Fall`] = character.fall || character.normal;
        if (character.propeller) {
          paths[`${characterId}PropellerCat`] = character.propeller.cat;
          paths[`${characterId}PropellerDog`] = character.propeller.dog;
        }
      }
      ZHUYA_ASSETS.springs.slipper.forEach((path, index) => {
        paths[`springSlipper${index}`] = path;
      });
      ZHUYA_ASSETS.springs.guitar.forEach((path, index) => {
        paths[`springGuitar${index}`] = path;
      });
      await Promise.all(
        Object.entries(paths).map(async ([key, path]) => {
          this.images[key] = await this.loadImage(path);
        }),
      );
      this.prepareRenderImageCache();
      this.backgroundPattern = this.context.createPattern(this.images.background, "repeat");
      this.applyCharacterAssets();
      this.assetsReady = true;
    }

    selectCharacter(characterId) {
      if (!ZHUYA_CHARACTERS[characterId] || this.running) return false;
      this.selectedCharacter = characterId;
      this.characterProfile = ZHUYA_CHARACTERS[characterId];
      if (this.assetsReady) this.applyCharacterAssets();
      return true;
    }

    applyCharacterAssets() {
      const id = this.selectedCharacter;
      const profile = ZHUYA_CHARACTERS[id];
      this.characterProfile = profile;
      this.images.playerNormal = this.images[`${id}Normal`];
      this.images.playerFall = this.images[`${id}Fall`] || this.images.playerNormal;
      this.images.playerPropellerCat = this.images[`${id}PropellerCat`] || null;
      this.images.playerPropellerDog = this.images[`${id}PropellerDog`] || null;
      this.playerNaturalScale = this.config.playerVisualHeight / this.images.playerNormal.height;
    }

    loadImage(path) {
      return new Promise((resolve, reject) => {
        const image = new Image();
        image.decoding = "async";
        image.onload = async () => {
          try {
            if (typeof image.decode === "function") await image.decode();
          } catch {
            // The onload event already guarantees a usable fallback image.
          }
          resolve(image);
        };
        image.onerror = () => reject(new Error(`Unable to load image: ${path}`));
        image.src = path;
      });
    }

    prepareRenderImageCache() {
      for (const [key, image] of Object.entries(this.images)) {
        let targetWidth = null;
        let targetHeight = null;
        if (key.startsWith("platform")) {
          targetWidth = 170;
          targetHeight = 30;
        } else if (key.startsWith("character")) {
          targetHeight = 200;
        } else if (key === "propellerCat" || key === "propellerDog") {
          targetWidth = 90;
        } else if (key === "medal") {
          targetWidth = 44;
          targetHeight = 44;
        } else if (key.startsWith("enemy")) {
          targetWidth = 112;
        } else if (key.startsWith("shield")) {
          targetWidth = 224;
          targetHeight = 224;
        } else if (key === "sword") {
          targetWidth = 128;
        } else if (key.startsWith("spring")) {
          targetWidth = 150;
        }
        if (!targetWidth && !targetHeight) continue;
        if (!targetWidth) targetWidth = Math.round((image.width / image.height) * targetHeight);
        if (!targetHeight) targetHeight = Math.round((image.height / image.width) * targetWidth);
        if (image.width <= targetWidth && image.height <= targetHeight) continue;

        const renderCanvas = document.createElement("canvas");
        renderCanvas.width = Math.max(1, targetWidth);
        renderCanvas.height = Math.max(1, targetHeight);
        const renderContext = renderCanvas.getContext("2d", { alpha: true });
        renderContext.imageSmoothingEnabled = true;
        renderContext.imageSmoothingQuality = "high";
        renderContext.drawImage(image, 0, 0, renderCanvas.width, renderCanvas.height);
        this.renderImageCache.set(image, renderCanvas);
        this.cachedRenderAssetCount += 1;
      }
    }

    bindGlobalListeners() {
      window.addEventListener("keydown", (event) => this.onKey(event, true), { passive: false });
      window.addEventListener("keyup", (event) => this.onKey(event, false), { passive: false });
      window.addEventListener("deviceorientation", (event) => this.onOrientation(event), {
        passive: true,
      });
      window.addEventListener("resize", () => this.fitCanvas(), { passive: true });
      window.addEventListener("orientationchange", () => {
        this.accumulator = 0;
        this.lastTimestamp = performance.now();
        this.fitCanvas();
      });
      document.addEventListener("visibilitychange", () => {
        this.accumulator = 0;
        this.lastTimestamp = performance.now();
        if (document.hidden) this.audio?.stopAllLoops();
        else this.restoreActiveLoop();
      });

      this.canvas.addEventListener("pointerdown", (event) => this.onPointerDown(event), {
        passive: false,
      });
      this.canvas.addEventListener("pointerup", (event) => this.onPointerUp(event), {
        passive: false,
      });
      this.canvas.addEventListener("pointercancel", (event) => this.onPointerUp(event), {
        passive: false,
      });
      this.canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    }

    onKey(event, pressed) {
      if (!this.running) return;
      const key = event.key.toLowerCase();
      if (pressed && this.debugEnabled) {
        if (key === "0") this.resetDebugFrameStats();
        if (key === "1") this.debugBeginFlight("propeller", "cat");
        if (key === "2") this.debugBeginFlight("propeller", "dog");
        if (key === "3") this.debugBeginFlight("sword");
        if (key === "4") this.debugActivateShield("buns");
        if (key === "5") this.debugActivateShield("axes");
        if (key === "6") this.debugPlacePickup("spring", "slipper");
        if (key === "7") this.debugPlacePickup("spring", "guitar");
        if (key === "8") this.debugPlacePickup("shield", "buns");
        if (key === "9") this.debugPlacePickup("shield", "axes");
        if (key === "0") this.triggerDeath("fall");
      }
      if (["arrowleft", "arrowright", "a", "d", " "].includes(key)) {
        event.preventDefault();
      }
      if (key === "arrowleft" || key === "a") this.input.left = pressed;
      if (key === "arrowright" || key === "d") this.input.right = pressed;
      if (key === " ") this.input.shoot = pressed;
    }

    pointerRole(event) {
      const bounds = this.canvas.getBoundingClientRect();
      const x = (event.clientX - bounds.left) / bounds.width;
      return x < 0.5 ? "left" : "right";
    }

    onPointerDown(event) {
      if (!this.running) return;
      event.preventDefault();
      const role = this.pointerRole(event);
      this.input.pointers.set(event.pointerId, role);
      this.canvas.setPointerCapture?.(event.pointerId);
    }

    onPointerUp(event) {
      if (!this.running) return;
      event.preventDefault();
      this.input.pointers.delete(event.pointerId);
      if (this.canvas.hasPointerCapture?.(event.pointerId)) {
        this.canvas.releasePointerCapture(event.pointerId);
      }
    }

    beginExternalPointer(pointerId, role) {
      if (!this.running) return;
      const key = `external:${pointerId}`;
      this.input.pointers.set(key, role);
      if (role === "shoot") this.tryShoot(true);
    }

    endExternalPointer(pointerId) {
      this.input.pointers.delete(`external:${pointerId}`);
    }

    onOrientation(event) {
      if (!this.tilt.permission || typeof event.gamma !== "number") return;
      if (this.tilt.baseline === null) this.tilt.baseline = event.gamma;
      const relative = event.gamma - this.tilt.baseline;
      this.tilt.filtered = lerp(this.tilt.filtered, relative, this.config.tiltLowPass);
      if (!this.tilt.received) {
        this.tilt.received = true;
        this.onControlMode("tilt");
      }
    }

    async requestOrientationPermission() {
      const orientation = window.DeviceOrientationEvent;
      if (!orientation) {
        this.tilt.permission = false;
        this.onControlMode("touch");
        return false;
      }
      try {
        if (typeof orientation.requestPermission === "function") {
          this.tilt.permission = (await orientation.requestPermission()) === "granted";
        } else {
          this.tilt.permission = true;
        }
      } catch {
        this.tilt.permission = false;
      }
      if (!this.tilt.permission) this.onControlMode("touch");
      return this.tilt.permission;
    }

    async start() {
      await this.load();
      if (!this.running) {
        const ratioHeight = Math.round(
          (this.config.logicalWidth * window.innerHeight) / Math.max(1, window.innerWidth),
        );
        this.logicalHeight = clamp(
          ratioHeight,
          this.config.minLogicalHeight,
          this.config.maxLogicalHeight,
        );
      }
      this.fitCanvas();
      this.resetState();
      this.running = true;
      this.lastTimestamp = performance.now();
      this.accumulator = 0;
      if (!this.loopStarted) {
        this.loopStarted = true;
        requestAnimationFrame(this.boundFrame);
      }
    }

    stop() {
      this.running = false;
      this.audio?.stopAllLoops();
      this.clearInput();
    }

    clearInput() {
      this.input.left = false;
      this.input.right = false;
      this.input.shoot = false;
      this.input.pointers.clear();
    }

    resetState() {
      this.audio?.stopAllLoops();
      this.clearInput();
      this.entityId = 1;
      this.elapsed = 0;
      this.cameraY = 0;
      this.previousCameraY = 0;
      this.renderCameraY = 0;
      this.maxPlayerHeight = 95;
      this.baseScore = 0;
      this.medalBonus = 0;
      this.score = 0;
      this.platforms = [];
      this.medals = [];
      this.enemies = [];
      this.bullets = [];
      this.effects = [];
      this.generatedCount = 0;
      this.lastRoutePlatform = null;
      this.spawnHistory = {
        spring: -999,
        shield: -999,
        propeller: -999,
        sword: -999,
        flight: -999,
      };
      this.nextShotAt = 0;
      this.pickupTransition = null;
      this.player = {
        x: 200,
        y: 95,
        previousX: 200,
        previousY: 95,
        vx: 0,
        vy: this.config.normalJumpVelocity,
        state: "normal",
        stateElapsed: 0,
        flightStartVelocity: 0,
        propellerKind: "cat",
        shield: null,
        deadElapsed: 0,
      };
      const base = this.makePlatform(158, 82, "normal", 1);
      this.platforms.push(base);
      this.lastRoutePlatform = base;
      this.generatedCount = 1;
      while (this.highestPlatformY() < this.logicalHeight + this.config.platformTopBuffer) {
        this.generateNextPlatform();
      }
      this.ensureVisiblePlatformDensity();
      this.player.x = base.x + base.width / 2;
      this.player.previousX = this.player.x;
      this.lastScoreSent = -1;
      this.sendScore();
    }

    makePlatform(x, y, majorType, index) {
      const platform = {
        id: this.entityId++,
        x,
        previousX: x,
        y,
        width: this.config.platformWidth,
        height: this.config.platformHeight,
        index,
        majorType,
        colour: this.choosePlatformColour(),
        consumed: false,
        movingVelocity: 0,
        movingMinimum: 0,
        movingMaximum: this.config.logicalWidth - this.config.platformWidth,
        brokenElapsed: -1,
        springKind: Math.random() < 0.5 ? "slipper" : "guitar",
        springElapsed: -1,
        propellerKind: Math.random() < 0.5 ? "cat" : "dog",
        shieldKind: Math.random() < this.config.shieldAxesShare ? "axes" : "buns",
      };
      if (majorType === "moving") {
        const travel = randomBetween(36, 74);
        platform.movingMinimum = clamp(x - travel, 0, this.config.logicalWidth - platform.width);
        platform.movingMaximum = clamp(x + travel, 0, this.config.logicalWidth - platform.width);
        platform.movingVelocity = (Math.random() < 0.5 ? -1 : 1) * randomBetween(34, 50);
      }
      return platform;
    }

    choosePlatformColour() {
      const roll = Math.random();
      if (roll < 0.55) return "white";
      if (roll < 0.89) return "brown";
      return "yellow";
    }

    highestPlatformY() {
      let highest = 0;
      for (const platform of this.platforms) highest = Math.max(highest, platform.y);
      return highest;
    }

    stageWeights(index) {
      const full = this.config.mainSpawnWeights;
      if (index <= 6) {
        return { normal: 1, broken: 0, moving: 0, spring: 0, propeller: 0, shield: 0, sword: 0 };
      }
      const early = {
        normal: 0.925,
        broken: 0.035,
        moving: 0,
        spring: 0.04,
        propeller: 0,
        shield: 0,
        sword: 0,
      };
      if (index <= 12) return early;
      if (index >= 20) return full;
      const progress = (index - 12) / 8;
      const weights = {};
      for (const key of Object.keys(full)) weights[key] = lerp(early[key], full[key], progress);
      return weights;
    }

    rollMajorType(index) {
      const weights = this.stageWeights(index);
      let roll = Math.random();
      for (const key of ["normal", "broken", "moving", "spring", "propeller", "shield", "sword"]) {
        roll -= weights[key];
        if (roll <= 0) return this.majorAllowed(key, index) ? key : "normal";
      }
      return "normal";
    }

    visibleSpecialCount(type = null) {
      const minimum = this.cameraY - 30;
      const maximum = this.cameraY + this.logicalHeight + this.config.platformTopBuffer;
      let count = 0;
      for (const platform of this.platforms) {
        if (platform.y < minimum || platform.y > maximum || platform.consumed) continue;
        if (type === "flight") {
          if (platform.majorType === "propeller" || platform.majorType === "sword") count += 1;
        } else if (type) {
          if (platform.majorType === type) count += 1;
        } else if (platform.majorType !== "normal") {
          count += 1;
        }
      }
      return count;
    }

    majorAllowed(type, index) {
      if (type === "normal") return true;
      if (this.visibleSpecialCount() >= this.config.maxVisibleMajorSpecials) return false;
      if (type === "spring") {
        return (
          this.visibleSpecialCount("spring") < this.config.maxVisibleSprings &&
          index - this.spawnHistory.spring > this.config.springCooldownPlatforms
        );
      }
      if (type === "shield") {
        return index - this.spawnHistory.shield > this.config.shieldCooldownPlatforms;
      }
      if (type === "propeller") {
        return (
          this.visibleSpecialCount("flight") < this.config.maxVisibleFlightPickups &&
          index - this.spawnHistory.propeller > this.config.propellerCooldownPlatforms &&
          index - this.spawnHistory.flight > this.config.sharedFlightCooldownPlatforms
        );
      }
      if (type === "sword") {
        return (
          index >= 13 &&
          this.visibleSpecialCount("flight") < this.config.maxVisibleFlightPickups &&
          index - this.spawnHistory.sword > this.config.swordCooldownPlatforms &&
          index - this.spawnHistory.flight > this.config.sharedFlightCooldownPlatforms
        );
      }
      return true;
    }

    recordMajorSpawn(type, index) {
      if (["spring", "shield", "propeller", "sword"].includes(type)) {
        this.spawnHistory[type] = index;
      }
      if (type === "propeller" || type === "sword") this.spawnHistory.flight = index;
    }

    platformHasRaisedPickup(platform) {
      return ["spring", "shield", "propeller", "sword"].includes(platform?.majorType);
    }

    generateNextPlatform() {
      const index = this.generatedCount + 1;
      this.generatedCount = index;
      const previous = this.lastRoutePlatform;
      const difficulty = clamp((index - 20) / 90, 0, 1);
      const densityGap = this.logicalHeight / Math.max(1, this.config.visiblePlatformTarget - 1);
      const minimumGap = clamp(densityGap - 5 + difficulty * 4, 46, 76);
      const maximumGap = clamp(densityGap + 6 + difficulty * 7, 56, 88);
      let gap = randomBetween(minimumGap, maximumGap);
      if (this.platformHasRaisedPickup(previous)) {
        gap = Math.max(gap, this.config.pickupClearanceGap);
      }
      const y = previous.y + gap;

      const discriminant = Math.max(
        0,
        this.config.normalJumpVelocity ** 2 - 2 * this.config.gravity * gap,
      );
      const descendingTime =
        (this.config.normalJumpVelocity + Math.sqrt(discriminant)) / this.config.gravity;
      const reachable = clamp(
        this.config.horizontalMaxSpeed * Math.max(0.1, descendingTime - 0.12) * 0.72 + 18,
        72,
        148,
      );
      const spread = lerp(0.68, 1, difficulty);
      const previousCenter = previous.x + previous.width / 2;
      let center = clamp(
        previousCenter + randomBetween(-reachable * spread, reachable * spread),
        this.config.platformWidth / 2 + 7,
        this.config.logicalWidth - this.config.platformWidth / 2 - 7,
      );
      if (this.platformHasRaisedPickup(previous)) {
        const routeMinimum = Math.max(
          this.config.platformWidth / 2 + 7,
          previousCenter - reachable * 0.9,
        );
        const routeMaximum = Math.min(
          this.config.logicalWidth - this.config.platformWidth / 2 - 7,
          previousCenter + reachable * 0.9,
        );
        const leftCandidate = clamp(
          previousCenter - this.config.pickupHorizontalClearance,
          routeMinimum,
          routeMaximum,
        );
        const rightCandidate = clamp(
          previousCenter + this.config.pickupHorizontalClearance,
          routeMinimum,
          routeMaximum,
        );
        center = Math.abs(leftCandidate - previousCenter) > Math.abs(rightCandidate - previousCenter)
          ? leftCandidate
          : rightCandidate;
      }
      const majorType = this.rollMajorType(index);
      const platform = this.makePlatform(center - this.config.platformWidth / 2, y, majorType, index);
      this.recordMajorSpawn(majorType, index);
      this.platforms.push(platform);
      this.lastRoutePlatform = platform;

      const medalRate = index <= 6 ? 0.055 : this.config.medalSpawnRate;
      if (!this.platformHasRaisedPickup(platform) && Math.random() < medalRate) {
        this.spawnMedal(platform);
      }
      this.maybeSpawnEnemy(platform, index);
    }

    spawnMedal(platform) {
      let offset = randomBetween(-36, 36);
      if (Math.abs(offset) < 11) offset += Math.sign(offset || 1) * 16;
      this.medals.push({
        id: this.entityId++,
        x: clamp(platform.x + platform.width / 2 + offset, 18, this.config.logicalWidth - 18),
        y: platform.y + randomBetween(31, 45),
        consumed: false,
        bob: Math.random() * Math.PI * 2,
      });
    }

    maybeSpawnEnemy(platform, index) {
      if (index <= 6) return;
      if (this.platformHasRaisedPickup(platform)) return;
      const stageRate = index <= 12 ? 0.015 : this.config.enemySpawnRate * clamp((index - 10) / 10, 0.2, 1);
      const maximum = index < 46 ? 1 : 2;
      let visible = 0;
      for (const enemy of this.enemies) {
        if (!enemy.consumed && enemy.y > this.cameraY && enemy.y < this.cameraY + this.logicalHeight) {
          visible += 1;
        }
      }
      if (visible >= maximum || Math.random() >= stageRate) return;
      const toRight = platform.x + platform.width / 2 < this.config.logicalWidth / 2;
      const x = toRight
        ? clamp(platform.x + platform.width + 43, 28, this.config.logicalWidth - 28)
        : clamp(platform.x - 43, 28, this.config.logicalWidth - 28);
      const kinds = ["crab", "lobster", "spider"];
      this.enemies.push({
        id: this.entityId++,
        x,
        y: platform.y + randomBetween(42, 58),
        kind: kinds[Math.floor(Math.random() * kinds.length)],
        phase: Math.random() * Math.PI * 2,
        consumed: false,
      });
    }

    ensureWorld() {
      while (this.highestPlatformY() < this.cameraY + this.logicalHeight + this.config.platformTopBuffer) {
        this.generateNextPlatform();
      }
      const cutoff = this.cameraY - 150;
      compactWorldList(this.platforms, cutoff, false);
      compactWorldList(this.medals, cutoff);
      compactWorldList(this.enemies, cutoff);
      compactWorldList(this.bullets, cutoff);
      this.ensureVisiblePlatformDensity();
    }

    ensureVisiblePlatformDensity() {
      const minimum = this.cameraY;
      const maximum = this.cameraY + this.logicalHeight;
      let visibleCount = 0;
      for (const platform of this.platforms) {
        if (platform.y >= minimum && platform.y <= maximum) visibleCount += 1;
      }
      if (visibleCount >= this.config.visiblePlatformMinimum) return;

      const visible = [];
      for (const platform of this.platforms) {
        if (platform.y >= minimum && platform.y <= maximum) visible.push(platform);
      }
      visible.sort((first, second) => first.y - second.y);
      let attempts = 0;
      while (visible.length < this.config.visiblePlatformMinimum && visible.length && attempts < 12) {
        const source = visible[(visible.length + attempts * 3) % visible.length];
        const sourceCenter = source.x + source.width / 2;
        const leftX = 8;
        const rightX = this.config.logicalWidth - this.config.platformWidth - 8;
        const x = Math.abs(leftX + this.config.platformWidth / 2 - sourceCenter) >
          Math.abs(rightX + this.config.platformWidth / 2 - sourceCenter)
          ? leftX
          : rightX;
        const y = clamp(source.y + ((attempts % 3) - 1) * 7, minimum + 24, maximum - 24);
        const overlaps = visible.some(
          (platform) => Math.abs(platform.y - y) < 18 && Math.abs(platform.x - x) < 72,
        );
        attempts += 1;
        if (overlaps) continue;
        const companion = this.makePlatform(x, y, "normal", source.index);
        companion.isCompanion = true;
        this.platforms.push(companion);
        visible.push(companion);
      }
    }

    calculateBackingResolution(cssWidth, logicalHeight = this.logicalHeight, deviceDpr = window.devicePixelRatio || 1) {
      const dpr = Math.min(deviceDpr, this.config.maxDevicePixelRatio);
      const backingCssWidth = Math.min(cssWidth, this.config.logicalWidth);
      const backingScale = backingCssWidth / this.config.logicalWidth;
      return {
        dpr,
        backingScale,
        pixelWidth: Math.max(1, Math.round(this.config.logicalWidth * backingScale * dpr)),
        pixelHeight: Math.max(1, Math.round(logicalHeight * backingScale * dpr)),
      };
    }

    fitCanvas() {
      const availableWidth = window.innerWidth;
      const availableHeight = window.innerHeight;
      const width = Math.min(availableWidth, (availableHeight * this.config.logicalWidth) / this.logicalHeight);
      const height = (width * this.logicalHeight) / this.config.logicalWidth;
      this.stage.style.width = `${Math.round(width)}px`;
      this.stage.style.height = `${Math.round(height)}px`;
      const { pixelWidth, pixelHeight } = this.calculateBackingResolution(width);
      if (this.canvas.width !== pixelWidth) this.canvas.width = pixelWidth;
      if (this.canvas.height !== pixelHeight) this.canvas.height = pixelHeight;
      this.canvasCssWidth = width;
      this.canvasCssHeight = height;
      this.canvasPixelScale = pixelWidth / this.config.logicalWidth;
      this.context.setTransform(this.canvasPixelScale, 0, 0, this.canvasPixelScale, 0, 0);
      this.context.imageSmoothingEnabled = true;
      this.context.imageSmoothingQuality = "medium";
    }

    frame(timestamp) {
      const rawDelta = (timestamp - this.lastTimestamp) / 1000;
      this.lastTimestamp = timestamp;
      const frameDelta = document.hidden ? 0 : clamp(rawDelta, 0, this.config.maxFrameDelta);
      if (this.running) {
        this.accumulator += frameDelta;
        let steps = 0;
        while (this.accumulator >= this.config.fixedStep && steps < 5) {
          this.update(this.config.fixedStep);
          this.accumulator -= this.config.fixedStep;
          steps += 1;
        }
        if (steps >= 5) this.accumulator = 0;
        if (this.debugEnabled) {
          this.debugFrameStats.frameDelta = frameDelta;
          this.debugFrameStats.fixedSteps = steps;
          this.debugFrameStats.maximumFixedSteps = Math.max(
            this.debugFrameStats.maximumFixedSteps,
            steps,
          );
          if (rawDelta > 0 && rawDelta < 1 && this.debugFrameTimes) {
            this.debugFrameTimes[this.debugFrameTimeCursor] = rawDelta * 1000;
            this.debugFrameTimeCursor = (this.debugFrameTimeCursor + 1) % this.debugFrameTimes.length;
            this.debugFrameTimeCount = Math.min(
              this.debugFrameTimeCount + 1,
              this.debugFrameTimes.length,
            );
          }
        }
        this.render(this.accumulator / this.config.fixedStep);
      }
      requestAnimationFrame(this.boundFrame);
    }

    inputAxis() {
      let axis = 0;
      if (this.input.left) axis -= 1;
      if (this.input.right) axis += 1;
      for (const role of this.input.pointers.values()) {
        if (role === "left") axis -= 1;
        if (role === "right") axis += 1;
      }
      axis = clamp(axis, -1, 1);
      if (axis !== 0) return axis;
      if (this.tilt.permission && this.tilt.received) {
        const angle = this.tilt.filtered;
        if (Math.abs(angle) <= this.config.tiltDeadZone) return 0;
        const magnitude =
          (Math.abs(angle) - this.config.tiltDeadZone) /
          (this.config.tiltMaxAngle - this.config.tiltDeadZone);
        return Math.sign(angle) * clamp(magnitude, 0, 1);
      }
      return 0;
    }

    shootHeld() {
      if (this.input.shoot) return true;
      for (const role of this.input.pointers.values()) if (role === "shoot") return true;
      return false;
    }

    update(delta) {
      this.elapsed += delta;
      this.previousCameraY = this.cameraY;
      const player = this.player;
      player.previousX = player.x;
      player.previousY = player.y;
      for (const platform of this.platforms) platform.previousX = platform.x;

      this.updatePlatforms(delta);
      this.updateShield(delta);

      if (player.state === "dead") {
        player.deadElapsed += delta;
        player.vy -= this.config.gravity * delta;
        player.y += player.vy * delta;
        if (player.deadElapsed > 0.42 && player.y < this.cameraY - 110) this.finishGameOver();
        return;
      }

      this.updateHorizontal(delta);
      this.updatePickupTransition(delta);
      if (player.state === "propellerFlight" || player.state === "swordRide") {
        this.updateFlight(delta);
      } else {
        this.updateNormalPhysics(delta);
      }

      this.collectMedals();
      this.collectMajorPickups();
      this.updateBullets(delta);
      this.updateEnemyCollisions();
      if (this.shootHeld()) this.tryShoot(false);
      this.updateEffects(delta);

      this.maxPlayerHeight = Math.max(this.maxPlayerHeight, player.y);
      const cameraCandidate = player.y - this.logicalHeight * (1 - this.config.cameraThreshold);
      if (cameraCandidate > this.cameraY) this.cameraY = cameraCandidate;
      this.baseScore = Math.floor(
        Math.max(0, this.maxPlayerHeight - 95) / this.config.baseScoreBand,
      );
      this.score = this.baseScore + this.medalBonus;
      this.sendScore();
      this.ensureWorld();

      if (player.state === "normal" && player.y < this.cameraY + 8) this.triggerDeath("fall");
    }

    updateHorizontal(delta) {
      const player = this.player;
      const axis = this.inputAxis();
      const target = axis * this.config.horizontalMaxSpeed;
      const rate = axis === 0 ? this.config.horizontalDeceleration : this.config.horizontalAcceleration;
      player.vx = moveTowards(player.vx, target, rate * delta);
      player.x += player.vx * delta;
      const wrapPadding = 35;
      if (player.x < -wrapPadding) {
        player.x = this.config.logicalWidth + wrapPadding;
        player.previousX = player.x;
      }
      if (player.x > this.config.logicalWidth + wrapPadding) {
        player.x = -wrapPadding;
        player.previousX = player.x;
      }
    }

    updatePlatforms(delta) {
      for (const platform of this.platforms) {
        if (platform.majorType === "moving") {
          platform.x += platform.movingVelocity * delta;
          if (platform.x <= platform.movingMinimum) {
            platform.x = platform.movingMinimum;
            platform.movingVelocity = Math.abs(platform.movingVelocity);
          } else if (platform.x >= platform.movingMaximum) {
            platform.x = platform.movingMaximum;
            platform.movingVelocity = -Math.abs(platform.movingVelocity);
          }
        }
        if (platform.brokenElapsed >= 0) platform.brokenElapsed += delta;
        if (platform.springElapsed >= 0) {
          platform.springElapsed += delta;
          if (platform.springElapsed >= this.config.springAnimationDuration) {
            platform.springElapsed = -1;
          }
        }
      }
    }

    updateNormalPhysics(delta) {
      const player = this.player;
      player.vy -= this.config.gravity * delta;
      player.y += player.vy * delta;
      if (player.vy < 0) this.detectLanding();
    }

    detectLanding() {
      const player = this.player;
      let platform = null;
      for (const candidate of this.platforms) {
        if (candidate.brokenElapsed >= 0) continue;
        const crossed = player.previousY >= candidate.y && player.y <= candidate.y;
        const horizontal =
          player.x + this.config.playerFootHalfWidth >= candidate.x &&
          player.x - this.config.playerFootHalfWidth <= candidate.x + candidate.width;
        if (crossed && horizontal && (!platform || candidate.y > platform.y)) platform = candidate;
      }
      if (!platform) return;
      player.y = platform.y;
      if (platform.majorType === "sword" && !platform.consumed) {
        platform.consumed = true;
        this.spawnHistory.sword = this.generatedCount;
        this.spawnHistory.flight = this.generatedCount;
        this.beginFlight("sword");
        return;
      }
      if (platform.majorType === "spring") {
        platform.springElapsed = 0;
        player.vy = this.config.springJumpVelocity;
        this.audio?.play("spring", 0.22);
      } else {
        player.vy = this.config.normalJumpVelocity;
        this.audio?.play("jump", 0.13);
      }
      if (platform.majorType === "broken") {
        platform.brokenElapsed = 0;
        this.audio?.play("break", 0.13);
      }
    }

    collectMedals() {
      const player = this.player;
      const left = player.x - this.config.playerBodyWidth / 2;
      const bottom = player.y + 7;
      for (const medal of this.medals) {
        if (medal.consumed) continue;
        if (rectsOverlap(left, bottom, this.config.playerBodyWidth, 64, medal.x - 11, medal.y - 11, 22, 22)) {
          medal.consumed = true;
          this.medalBonus += this.config.medalScore;
          this.effects.push({
            id: this.entityId++,
            type: "score",
            x: medal.x,
            y: medal.y,
            elapsed: 0,
            duration: 0.55,
          });
          this.audio?.play("medal", 0.18);
        }
      }
    }

    collectMajorPickups() {
      const player = this.player;
      if (player.state !== "normal" || this.pickupTransition) return;
      const left = player.x - this.config.playerBodyWidth / 2;
      const bottom = player.y + 5;
      for (const platform of this.platforms) {
        if (platform.consumed) continue;
        const centerX = platform.x + platform.width / 2;
        const itemY = platform.y + 20;
        const pickupHalfWidth = platform.majorType === "shield"
          ? 32
          : platform.majorType === "propeller"
            ? 28
            : 22;
        const pickupHeight = platform.majorType === "propeller"
          ? 42
          : platform.majorType === "shield"
            ? 60
            : 34;
        if (!rectsOverlap(
          left,
          bottom,
          this.config.playerBodyWidth,
          72,
          centerX - pickupHalfWidth,
          itemY - 15,
          pickupHalfWidth * 2,
          pickupHeight,
        )) {
          continue;
        }
        if (platform.majorType === "propeller") {
          platform.consumed = true;
          this.spawnHistory.propeller = this.generatedCount;
          this.spawnHistory.flight = this.generatedCount;
          this.pickupTransition = {
            type: "propeller",
            kind: platform.propellerKind,
            startX: centerX,
            startY: itemY,
            elapsed: 0,
            duration: this.config.flightTransitionDuration,
          };
          this.audio?.play("pickup", 0.16);
          break;
        }
        if (platform.majorType === "shield") {
          platform.consumed = true;
          this.activateShield(platform.shieldKind);
          break;
        }
      }
    }

    updatePickupTransition(delta) {
      if (!this.pickupTransition) return;
      this.pickupTransition.elapsed += delta;
      if (this.pickupTransition.elapsed >= this.pickupTransition.duration) {
        const kind = this.pickupTransition.kind;
        this.pickupTransition = null;
        this.player.propellerKind = kind;
        this.beginFlight("propeller");
      }
    }

    beginFlight(type) {
      const player = this.player;
      player.state = type === "sword" ? "swordRide" : "propellerFlight";
      player.stateElapsed = 0;
      player.flightStartVelocity = player.vy;
      if (type === "sword") this.audio?.play("swordStart", 0.13);
    }

    updateFlight(delta) {
      const player = this.player;
      const isSword = player.state === "swordRide";
      const duration = isSword ? this.config.swordDuration : this.config.propellerDuration;
      const targetVelocity = isSword
        ? this.config.swordFlightSpeed
        : this.config.propellerFlightSpeed;
      const transition = this.config.flightTransitionDuration;
      player.stateElapsed += delta;
      if (player.stateElapsed < transition) {
        const progress = easeInOut(player.stateElapsed / transition);
        player.vy = lerp(player.flightStartVelocity, targetVelocity, progress);
      } else if (player.stateElapsed > duration - transition) {
        const progress = easeInOut((player.stateElapsed - (duration - transition)) / transition);
        player.vy = lerp(targetVelocity, 185, progress);
      } else {
        player.vy = targetVelocity;
      }
      player.y += player.vy * delta;
      if (player.stateElapsed >= duration) {
        player.state = "normal";
        player.stateElapsed = 0;
        player.vy = 185;
      }
    }

    activateShield(kind) {
      this.player.shield = {
        kind,
        remaining: this.config.shieldDuration,
        phase: "active",
        phaseElapsed: 0,
      };
      this.spawnHistory.shield = this.generatedCount;
      this.audio?.play("shield", 0.16);
    }

    updateShield(delta) {
      const shield = this.player?.shield;
      if (!shield) return;
      shield.phaseElapsed += delta;
      if (shield.phase === "active") {
        shield.remaining -= delta;
        if (shield.remaining <= 0) {
          shield.phase = "fade";
          shield.phaseElapsed = 0;
        }
      } else if (shield.phase === "flash" && shield.phaseElapsed >= this.config.shieldFlashDuration) {
        shield.phase = "fade";
        shield.phaseElapsed = 0;
      } else if (shield.phase === "fade" && shield.phaseElapsed >= this.config.shieldFadeDuration) {
        this.player.shield = null;
      }
    }

    tryShoot(immediate) {
      if (!this.running || this.player.state !== "normal") return;
      if (!immediate && this.elapsed < this.nextShotAt) return;
      if (immediate && this.elapsed < this.nextShotAt) return;
      this.nextShotAt = this.elapsed + this.config.shotCooldown;
      const target = this.closestEnemyAbove();
      const muzzleY = this.player.y + 80;
      for (const side of [-1, 1]) {
        this.bullets.push({
          id: this.entityId++,
          x: this.player.x + side * 19,
          y: muzzleY,
          previousX: this.player.x + side * 19,
          previousY: muzzleY,
          vx: -side * 44,
          vy: this.config.bulletSpeed,
          targetId: target?.id ?? null,
          consumed: false,
        });
      }
      this.audio?.play("shot", 0.1);
    }

    closestEnemyAbove() {
      let closest = null;
      for (const enemy of this.enemies) {
        if (enemy.consumed || enemy.y <= this.player.y) continue;
        if (!closest || enemy.y < closest.y) closest = enemy;
      }
      return closest;
    }

    updateBullets(delta) {
      for (const bullet of this.bullets) {
        if (bullet.consumed) continue;
        bullet.previousX = bullet.x;
        bullet.previousY = bullet.y;
        const target = this.enemies.find(
          (enemy) => enemy.id === bullet.targetId && !enemy.consumed,
        );
        if (target) {
          const dx = target.x - bullet.x;
          const dy = target.y - bullet.y;
          const length = Math.max(1, Math.hypot(dx, dy));
          bullet.vx = (dx / length) * this.config.bulletSpeed;
          bullet.vy = (dy / length) * this.config.bulletSpeed;
        }
        bullet.x += bullet.vx * delta;
        bullet.y += bullet.vy * delta;
        if (
          bullet.y > this.cameraY + this.logicalHeight + 90 ||
          bullet.x < -30 ||
          bullet.x > this.config.logicalWidth + 30
        ) {
          bullet.consumed = true;
          continue;
        }
        for (const enemy of this.enemies) {
          if (enemy.consumed) continue;
          const size = this.enemySize(enemy.kind);
          if (
            rectsOverlap(
              bullet.x - 4,
              bullet.y - 6,
              8,
              12,
              enemy.x - size / 2,
              enemy.y - size / 2,
              size,
              size,
            )
          ) {
            bullet.consumed = true;
            enemy.consumed = true;
            this.audio?.play("hit", 0.13);
            break;
          }
        }
      }
    }

    updateEnemyCollisions() {
      const player = this.player;
      if (player.state === "propellerFlight" || player.state === "swordRide") return;
      const playerLeft = player.x - this.config.playerBodyWidth / 2;
      const playerBottom = player.y + 8;
      for (const enemy of this.enemies) {
        if (enemy.consumed) continue;
        const size = this.enemySize(enemy.kind) * 0.72;
        if (
          rectsOverlap(
            playerLeft,
            playerBottom,
            this.config.playerBodyWidth,
            this.config.playerBodyHeight - 8,
            enemy.x - size / 2,
            enemy.y - size / 2,
            size,
            size,
          )
        ) {
          if (player.shield?.phase === "active") {
            enemy.consumed = true;
            player.shield.phase = "flash";
            player.shield.phaseElapsed = 0;
            this.audio?.play("shieldHit", 0.18);
          } else {
            this.triggerDeath("enemy");
          }
          break;
        }
      }
    }

    enemySize(kind) {
      return kind === "spider" ? 43 : 56;
    }

    updateEffects(delta) {
      for (const effect of this.effects) effect.elapsed += delta;
      compactTimedList(this.effects);
    }

    triggerDeath(reason) {
      if (this.player.state === "dead") return;
      this.audio?.stopAllLoops();
      this.audio?.play("death", 0.2);
      this.player.state = "dead";
      this.player.deadElapsed = 0;
      this.player.vx *= 0.24;
      this.player.vy = reason === "enemy" ? 100 : Math.min(this.player.vy, -90);
      this.clearInput();
    }

    finishGameOver() {
      if (!this.running) return;
      this.running = false;
      this.audio?.stopAllLoops();
      this.onGameOver(this.score);
    }

    sendScore() {
      if (this.score === this.lastScoreSent) return;
      this.lastScoreSent = this.score;
      this.onScore(this.score);
    }

    restoreActiveLoop() {
      // Flight loops are intentionally disabled; other one-shot effects stay unchanged.
    }

    worldToScreenY(worldY, camera = this.renderCameraY ?? this.cameraY) {
      return this.logicalHeight - (worldY - camera);
    }

    drawWorldImage(image, centerX, footY, width, height, alpha = 1) {
      if (!image || alpha <= 0) return;
      const renderImage = this.renderImageCache.get(image) || image;
      const screenY = this.worldToScreenY(footY);
      if (alpha === 1) {
        this.context.drawImage(renderImage, centerX - width / 2, screenY - height, width, height);
        return;
      }
      this.context.save();
      this.context.globalAlpha = alpha;
      this.context.drawImage(renderImage, centerX - width / 2, screenY - height, width, height);
      this.context.restore();
    }

    drawCenteredWorldImage(image, centerX, centerY, width, height, alpha = 1) {
      if (!image || alpha <= 0) return;
      const renderImage = this.renderImageCache.get(image) || image;
      const screenY = this.worldToScreenY(centerY);
      if (alpha === 1) {
        this.context.drawImage(renderImage, centerX - width / 2, screenY - height / 2, width, height);
        return;
      }
      this.context.save();
      this.context.globalAlpha = alpha;
      this.context.drawImage(renderImage, centerX - width / 2, screenY - height / 2, width, height);
      this.context.restore();
    }

    render(interpolation) {
      const context = this.context;
      this.renderCameraY = lerp(this.previousCameraY, this.cameraY, interpolation);
      context.save();
      context.setTransform(
        this.canvas.width / this.config.logicalWidth,
        0,
        0,
        this.canvas.height / this.logicalHeight,
        0,
        0,
      );
      context.clearRect(0, 0, this.config.logicalWidth, this.logicalHeight);
      context.fillStyle = this.backgroundPattern || "#fbf2e3";
      context.fillRect(0, 0, this.config.logicalWidth, this.logicalHeight);

      this.renderPlatforms(interpolation);
      this.renderMedals();
      this.renderEnemies();
      this.renderBullets();
      this.renderPickupTransition();
      this.renderShield(interpolation);
      this.renderSword(interpolation);
      this.renderPlayer(interpolation);
      this.renderEffects();
      this.renderTouchGuides();
      context.fillStyle = "rgba(113, 76, 145, 0.72)";
      context.font = '12px "Comic Sans MS", sans-serif';
      context.textAlign = "right";
      context.fillText("@Hydrangeaaaa", this.config.logicalWidth - 12, this.logicalHeight - 14);
      if (this.debugEnabled && this.elapsed - this.lastDebugSnapshotAt >= 0.25) {
        this.lastDebugSnapshotAt = this.elapsed;
        this.canvas.dataset.debug = JSON.stringify(this.getDebugState());
      }
      context.restore();
    }

    renderPlatforms(interpolation) {
      for (const platform of this.platforms) {
        const x = lerp(platform.previousX, platform.x, interpolation);
        const y = this.worldToScreenY(platform.y);
        if (y < -35 || y > this.logicalHeight + 35) continue;
        let image = this.images[`platform${platform.colour[0].toUpperCase()}${platform.colour.slice(1)}`];
        if (platform.majorType === "broken") image = this.images.platformBroken;
        const renderImage = this.renderImageCache.get(image) || image;
        if (platform.brokenElapsed >= 0) {
          const progress = clamp(
            platform.brokenElapsed / this.config.brokenAnimationDuration,
            0,
            1,
          );
          this.context.save();
          this.context.globalAlpha = 1 - progress;
          const halfWidth = platform.width / 2;
          const fall = progress * progress * 40;
          this.context.drawImage(
            renderImage,
            0,
            0,
            renderImage.width / 2,
            renderImage.height,
            x - progress * 8,
            y + fall,
            halfWidth,
            platform.height,
          );
          this.context.drawImage(
            renderImage,
            renderImage.width / 2,
            0,
            renderImage.width / 2,
            renderImage.height,
            x + halfWidth + progress * 8,
            y + fall * 0.86,
            halfWidth,
            platform.height,
          );
          this.context.restore();
        } else {
          this.context.drawImage(renderImage, x, y, platform.width, platform.height);
        }
        this.renderPlatformMajor(platform, x);
      }
    }

    renderPlatformMajor(platform, x) {
      if (platform.consumed || platform.brokenElapsed >= 0) return;
      const centerX = x + platform.width / 2;
      if (platform.majorType === "spring") {
        const frame =
          platform.springElapsed < 0
            ? 0
            : Math.min(
                6,
                Math.floor(
                  (platform.springElapsed / this.config.springAnimationDuration) * 7,
                ),
              );
        const key = `spring${platform.springKind[0].toUpperCase()}${platform.springKind.slice(1)}${frame}`;
        const image = this.images[key];
        const width = platform.springKind === "guitar" ? 75 : 70;
        const height = (image.height / image.width) * width;
        this.drawWorldImage(image, centerX, platform.y + 1, width, height);
      } else if (platform.majorType === "propeller") {
        const image =
          platform.propellerKind === "cat" ? this.images.propellerCat : this.images.propellerDog;
        const width = 45;
        const height = (image.height / image.width) * width;
        this.drawWorldImage(image, centerX, platform.y + 1, width, height);
      } else if (platform.majorType === "shield") {
        const image = platform.shieldKind === "axes" ? this.images.shieldAxes : this.images.shieldBuns;
        const size = platform.shieldKind === "buns" ? 62 : 56;
        if (platform.shieldKind === "buns") {
          const screenCenterY = this.worldToScreenY(platform.y + 2) - size / 2;
          this.context.save();
          this.context.fillStyle = "rgb(255 241 193 / 82%)";
          this.context.strokeStyle = "rgb(118 92 47 / 52%)";
          this.context.lineWidth = 1.4;
          this.context.beginPath();
          this.context.arc(centerX, screenCenterY, size * 0.46, 0, Math.PI * 2);
          this.context.fill();
          this.context.stroke();
          this.context.restore();
        }
        this.drawWorldImage(image, centerX, platform.y + 2, size, size);
      } else if (platform.majorType === "sword") {
        const width = 61;
        const height = (this.images.sword.height / this.images.sword.width) * width;
        this.drawWorldImage(this.images.sword, centerX, platform.y + 3, width, height);
      }
    }

    renderMedals() {
      for (const medal of this.medals) {
        if (medal.consumed) continue;
        const bob = Math.sin(this.elapsed * 3 + medal.bob) * 2;
        const screenY = this.worldToScreenY(medal.y + bob);
        if (screenY < -30 || screenY > this.logicalHeight + 30) continue;
        this.drawCenteredWorldImage(this.images.medal, medal.x, medal.y + bob, 22, 22);
      }
    }

    renderEnemies() {
      for (const enemy of this.enemies) {
        if (enemy.consumed) continue;
        const size = this.enemySize(enemy.kind);
        const bob = Math.sin(this.elapsed * 2.1 + enemy.phase) * 3;
        const image = this.images[`enemy${enemy.kind[0].toUpperCase()}${enemy.kind.slice(1)}`];
        const width = size;
        const height = (image.height / image.width) * width;
        const screenY = this.worldToScreenY(enemy.y + bob);
        if (screenY < -height || screenY > this.logicalHeight + height) continue;
        this.drawCenteredWorldImage(image, enemy.x, enemy.y + bob, width, height);
      }
    }

    renderBullets() {
      this.context.fillStyle = "#fffdf5";
      this.context.strokeStyle = "#25221e";
      this.context.lineWidth = 1.6;
      for (const bullet of this.bullets) {
        if (bullet.consumed) continue;
        const y = this.worldToScreenY(bullet.y);
        if (y < -12 || y > this.logicalHeight + 12) continue;
        this.context.beginPath();
        this.context.ellipse(bullet.x, y, 4.2, 5.8, 0, 0, Math.PI * 2);
        this.context.fill();
        this.context.stroke();
      }
    }

    renderPickupTransition() {
      const transition = this.pickupTransition;
      if (!transition) return;
      const progress = easeInOut(transition.elapsed / transition.duration);
      const endX = this.player.x;
      const endY = this.player.y + 91;
      const controlX = (transition.startX + endX) / 2 + 18;
      const controlY = Math.max(transition.startY, endY) + 48;
      const inverse = 1 - progress;
      const x =
        inverse * inverse * transition.startX +
        2 * inverse * progress * controlX +
        progress * progress * endX;
      const y =
        inverse * inverse * transition.startY +
        2 * inverse * progress * controlY +
        progress * progress * endY;
      const image = transition.kind === "cat" ? this.images.propellerCat : this.images.propellerDog;
      const width = lerp(42, 27, progress);
      const height = (image.height / image.width) * width;
      this.drawCenteredWorldImage(image, x, y, width, height, 1 - clamp((progress - 0.78) / 0.22, 0, 1));
    }

    renderShield(interpolation) {
      const shield = this.player.shield;
      if (!shield || this.player.state === "dead") return;
      let alpha = 0.86;
      let scale = 1;
      if (shield.phase === "flash") scale = 1.03;
      if (shield.phase === "fade") {
        alpha *= 1 - clamp(shield.phaseElapsed / this.config.shieldFadeDuration, 0, 1);
      }
      const playerX = lerp(this.player.previousX, this.player.x, interpolation);
      const playerY = lerp(this.player.previousY, this.player.y, interpolation);
      const image = shield.kind === "axes" ? this.images.shieldAxes : this.images.shieldBuns;
      this.drawCenteredWorldImage(image, playerX, playerY + 42, 112 * scale, 112 * scale, alpha);
    }

    renderSword(interpolation) {
      if (this.player.state !== "swordRide") return;
      const x = lerp(this.player.previousX, this.player.x, interpolation);
      const y = lerp(this.player.previousY, this.player.y, interpolation);
      const width = 64;
      const height = (this.images.sword.height / this.images.sword.width) * width;
      this.drawCenteredWorldImage(this.images.sword, x, y - 5, width, height);
    }

    renderPlayer(interpolation) {
      const player = this.player;
      const x = lerp(player.previousX, player.x, interpolation);
      const y = lerp(player.previousY, player.y, interpolation);
      if (player.state === "dead") {
        this.drawPlayerSprite(
          this.images.playerFall,
          x,
          y,
          1,
          this.characterProfile.fallRotation || 0,
        );
        return;
      }
      let propellerAlpha = player.state === "propellerFlight" ? 1 : 0;
      if (this.pickupTransition) {
        propellerAlpha = clamp(
          (this.pickupTransition.elapsed - (this.pickupTransition.duration - 0.08)) / 0.08,
          0,
          1,
        );
      }
      if (player.state === "propellerFlight") {
        const remaining = this.config.propellerDuration - player.stateElapsed;
        if (remaining < 0.08) propellerAlpha = clamp(remaining / 0.08, 0, 1);
      }
      if (propellerAlpha > 0) {
        const image =
          player.propellerKind === "cat"
            ? this.images.playerPropellerCat
            : this.images.playerPropellerDog;
        if (image) {
          this.drawPlayerSprite(this.images.playerNormal, x, y, 1 - propellerAlpha);
          this.drawPlayerSprite(image, x, y, propellerAlpha);
        } else {
          this.drawPlayerSprite(this.images.playerNormal, x, y, 1);
          const propellerImage = player.propellerKind === "cat"
            ? this.images.propellerCat
            : this.images.propellerDog;
          const width = 29;
          const height = (propellerImage.height / propellerImage.width) * width;
          this.drawWorldImage(
            propellerImage,
            x,
            y + this.config.playerVisualHeight - 8,
            width,
            height,
            propellerAlpha,
          );
        }
      } else {
        this.drawPlayerSprite(this.images.playerNormal, x, y, 1);
      }
    }

    drawPlayerSprite(image, x, footY, alpha, rotation = 0) {
      const width = image.width * this.playerNaturalScale;
      const height = image.height * this.playerNaturalScale;
      if (!rotation) {
        this.drawWorldImage(image, x, footY, width, height, alpha);
        return;
      }
      const screenY = this.worldToScreenY(footY);
      const renderImage = this.renderImageCache.get(image) || image;
      this.context.save();
      this.context.globalAlpha = alpha;
      this.context.translate(x, screenY - height / 2);
      this.context.rotate(rotation);
      this.context.drawImage(renderImage, -width / 2, -height / 2, width, height);
      this.context.restore();
    }

    renderEffects() {
      for (const effect of this.effects) {
        if (effect.type !== "score") continue;
        const progress = effect.elapsed / effect.duration;
        const y = this.worldToScreenY(effect.y + progress * 26);
        if (y < -30 || y > this.logicalHeight + 30) continue;
        this.context.save();
        this.context.globalAlpha = 1 - progress;
        this.context.fillStyle = "#7b5a22";
        this.context.font = 'bold 13px "Comic Sans MS", sans-serif';
        this.context.textAlign = "center";
        this.context.fillText("+50", effect.x, y);
        this.context.restore();
      }
    }

    renderTouchGuides() {
      if (this.tilt.permission && this.tilt.received) return;
      const y = this.logicalHeight - 62;
      this.context.save();
      this.context.globalAlpha = 0.12;
      this.context.strokeStyle = "#29251f";
      this.context.fillStyle = "#fff8ea";
      this.context.lineWidth = 2;
      for (const [x, symbol] of [[62, "‹"], [338, "›"]]) {
        this.context.beginPath();
        this.context.arc(x, y, 27, 0, Math.PI * 2);
        this.context.fill();
        this.context.stroke();
        this.context.fillStyle = "#29251f";
        this.context.font = 'bold 28px "Comic Sans MS", sans-serif';
        this.context.textAlign = "center";
        this.context.textBaseline = "middle";
        this.context.fillText(symbol, x, y - 1);
        this.context.fillStyle = "#fff8ea";
      }
      this.context.restore();
    }

    getDebugState() {
      let visiblePlatforms = 0;
      let enemies = 0;
      let medals = 0;
      let bullets = 0;
      for (const platform of this.platforms) {
        if (platform.y >= this.cameraY && platform.y <= this.cameraY + this.logicalHeight) {
          visiblePlatforms += 1;
        }
      }
      for (const enemy of this.enemies) if (!enemy.consumed) enemies += 1;
      for (const medal of this.medals) if (!medal.consumed) medals += 1;
      for (const bullet of this.bullets) if (!bullet.consumed) bullets += 1;
      return {
        running: this.running,
        logicalHeight: this.logicalHeight,
        score: this.score,
        cameraY: this.cameraY,
        renderCameraY: this.renderCameraY,
        generatedCount: this.generatedCount,
        player: { ...this.player, shield: this.player.shield ? { ...this.player.shield } : null },
        platformCount: this.platforms.length,
        visiblePlatforms,
        visibleSpecials: this.visibleSpecialCount(),
        enemies,
        medals,
        bullets,
        audioLoops: this.audio?.loops?.size ?? 0,
        cachedRenderAssets: this.cachedRenderAssetCount,
        canvas: {
          cssWidth: this.canvasCssWidth,
          cssHeight: this.canvasCssHeight,
          pixelWidth: this.canvas.width,
          pixelHeight: this.canvas.height,
          pixelScale: this.canvasPixelScale,
          devicePixelRatio: window.devicePixelRatio || 1,
        },
        frame: { ...this.debugFrameStats, ...this.getDebugFrameSummary() },
      };
    }

    resetDebugFrameStats() {
      if (!this.debugEnabled) return;
      this.debugFrameStats.frameDelta = 0;
      this.debugFrameStats.fixedSteps = 0;
      this.debugFrameStats.maximumFixedSteps = 0;
      this.debugFrameTimeCount = 0;
      this.debugFrameTimeCursor = 0;
      this.debugFrameTimes?.fill(0);
      this.lastDebugSnapshotAt = -Infinity;
    }

    getDebugFrameSummary() {
      if (!this.debugFrameTimes || !this.debugFrameTimeCount) {
        return {
          samples: 0,
          averageFps: 0,
          averageFrameMs: 0,
          p95FrameMs: 0,
          p99FrameMs: 0,
          over16_7: 0,
          over33_3: 0,
        };
      }
      const values = [];
      let total = 0;
      let over16_7 = 0;
      let over33_3 = 0;
      for (let index = 0; index < this.debugFrameTimeCount; index += 1) {
        const value = this.debugFrameTimes[index];
        values.push(value);
        total += value;
        if (value > 16.7) over16_7 += 1;
        if (value > 33.3) over33_3 += 1;
      }
      values.sort((first, second) => first - second);
      const averageFrameMs = total / values.length;
      const percentile = (amount) => values[
        Math.min(values.length - 1, Math.floor(values.length * amount))
      ];
      return {
        samples: values.length,
        averageFps: 1000 / averageFrameMs,
        averageFrameMs,
        p95FrameMs: percentile(0.95),
        p99FrameMs: percentile(0.99),
        over16_7,
        over33_3,
      };
    }

    debugBeginFlight(type = "propeller", kind = "cat") {
      this.player.propellerKind = kind;
      this.beginFlight(type === "sword" ? "sword" : "propeller");
    }

    debugActivateShield(kind = "buns") {
      this.activateShield(kind);
    }

    debugPlacePickup(type, kind) {
      const target = this.platforms
        .filter(
          (platform) =>
            platform.y > this.player.y + 45 &&
            platform.y < this.cameraY + this.logicalHeight - 80,
        )
        .sort((first, second) => first.y - second.y)[0];
      if (!target) return;
      target.majorType = type;
      target.consumed = false;
      if (type === "spring") target.springKind = kind;
      if (type === "shield") target.shieldKind = kind;
    }
  }

  global.ZhuyaGame = ZhuyaGame;
})(window);

