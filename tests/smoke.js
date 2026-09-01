/* global window */
document.addEventListener("DOMContentLoaded", async () => {
  "use strict";
  const searchParameters = new URLSearchParams(window.location.search);
  if (!searchParameters.has("smoke") && !searchParameters.has("perf")) return;

  const results = [];
  const check = (name, passed, detail = "") => {
    results.push({ name, passed: Boolean(passed), detail });
  };
  const game = window.__zhuyaGame;
  const audio = window.__zhuyaAudio;
  const config = window.ZHUYA_CONFIG;
  if (!game || !config) {
    check("bootstrap", false, "Game globals unavailable");
    return;
  }

  if (searchParameters.has("perf")) {
    const wait = (duration) => new Promise((resolve) => window.setTimeout(resolve, duration));
    const profile = async (label, beginState = null) => {
      game.resetState();
      if (beginState) beginState();
      // Let first-frame layout, cache fills and state setup settle before measuring.
      await wait(350);
      game.resetDebugFrameStats();
      await wait(1500);
      const state = game.getDebugState();
      return {
        label,
        playerState: state.player.state,
        frame: state.frame,
        canvas: state.canvas,
        platformCount: state.platformCount,
        enemyCount: state.enemies,
        medalCount: state.medals,
        bulletCount: state.bullets,
        audioLoops: state.audioLoops,
      };
    };

    await game.start();
    const performanceResults = [
      await profile("NORMAL"),
      await profile("PROPELLER", () => game.debugBeginFlight("propeller", "cat")),
      await profile("SWORD", () => game.debugBeginFlight("sword")),
    ];
    game.running = false;
    audio?.stopAllLoops();
    const report = document.createElement("pre");
    report.id = "performance-results";
    report.textContent = JSON.stringify(performanceResults, null, 2);
    report.style.cssText =
      "position:fixed;inset:0;z-index:9999;overflow:auto;margin:0;padding:16px;background:#fff;color:#111;font:12px monospace;white-space:pre-wrap";
    document.body.appendChild(report);
    document.title = "PASS - Zhuya Performance";
    window.__ZHUYA_PERFORMANCE_RESULTS = performanceResults;
    return;
  }

  await game.start();
  game.running = false;

  const weights = config.mainSpawnWeights;
  const weightSum = Object.values(weights).reduce((sum, value) => sum + value, 0);
  check("main-weight-sum", Math.abs(weightSum - 1) < 1e-9, String(weightSum));
  check("sword-base-rate", weights.sword === 0.02, String(weights.sword));
  check("medal-rate", config.medalSpawnRate === 0.14, String(config.medalSpawnRate));
  check("shield-total-rate-unchanged", weights.shield === 0.03, String(weights.shield));
  check("axes-share-within-shields", config.shieldAxesShare === 0.6, String(config.shieldAxesShare));
  check("spring-height-raised", config.springJumpHeight === 380, String(config.springJumpHeight));
  check("mobile-dpr-cap", config.maxDevicePixelRatio === 1.5, String(config.maxDevicePixelRatio));
  check(
    "canvas-backing-respects-css-dpr-cap",
    game.canvas.width <= Math.ceil(Math.min(game.canvasCssWidth, config.logicalWidth) * config.maxDevicePixelRatio),
    `${game.canvas.width}/${game.canvasCssWidth}`,
  );
  const backingCases = [
    { name: "375x667", cssWidth: 375, logicalHeight: 711, expected: [563, 1000] },
    { name: "390x844", cssWidth: 390, logicalHeight: 866, expected: [585, 1267] },
    { name: "430x932", cssWidth: 430, logicalHeight: 867, expected: [600, 1301] },
  ];
  for (const testCase of backingCases) {
    const result = game.calculateBackingResolution(testCase.cssWidth, testCase.logicalHeight, 3);
    check(
      `canvas-backing-${testCase.name}`,
      result.pixelWidth === testCase.expected[0] && result.pixelHeight === testCase.expected[1],
      `${result.pixelWidth}x${result.pixelHeight}`,
    );
  }
  check("render-assets-pre-scaled", game.cachedRenderAssetCount > 0, String(game.cachedRenderAssetCount));
  check("shoot-button-present", Boolean(document.querySelector("#shoot-button")));
  check("mobile-audio-gesture-primer", typeof audio?.primeFromGesture === "function");
  const audioFiles = [
    "start.wav", "jump.wav", "spring.wav", "pickup.wav", "medal.wav", "shield.wav",
    "shield-hit.wav", "shot.wav", "hit.wav", "break.wav", "death.wav", "sword-start.wav",
  ];
  const audioResponses = await Promise.all(
    audioFiles.map((file) => fetch(`assets/audio/${file}`, { cache: "no-store" })),
  );
  check(
    "remaining-audio-files-available",
    audioResponses.every((response) => response.ok),
    audioResponses.map((response) => response.status).join(","),
  );
  check(
    "flight-loop-audio-removed",
    !audio.htmlTemplates.has("propellerLoop") && !audio.htmlTemplates.has("swordLoop"),
  );
  const oneShotNames = [
    "start", "jump", "spring", "pickup", "medal", "shield",
    "shieldHit", "shot", "hit", "break", "death", "swordStart",
  ];
  check(
    "one-shot-html-pools-precreated",
    oneShotNames.every((name) => {
      const pool = audio.htmlPools.get(name);
      return pool?.length === 3 && new Set(pool).size === 3 && audio.htmlTemplates.get(name) === pool[0];
    }),
    oneShotNames.map((name) => `${name}:${audio.htmlPools.get(name)?.length || 0}`).join(","),
  );

  const poolPlayCounts = [0, 0, 0];
  const poolProbe = poolPlayCounts.map((_, index) => ({
    currentTime: 0,
    muted: false,
    volume: 1,
    paused: true,
    ended: false,
    play() {
      poolPlayCounts[index] += 1;
      return Promise.resolve();
    },
  }));
  audio.htmlPools.set("poolProbe", poolProbe);
  audio.htmlPoolIndexes.set("poolProbe", 0);
  for (let playIndex = 0; playIndex < 20; playIndex += 1) audio.playHtml("poolProbe", 0.12);
  check(
    "one-shot-pool-round-robin-overlap",
    poolPlayCounts.reduce((sum, count) => sum + count, 0) === 20 &&
      Math.max(...poolPlayCounts) - Math.min(...poolPlayCounts) <= 1,
    poolPlayCounts.join(","),
  );
  audio.htmlPools.delete("poolProbe");
  audio.htmlPoolIndexes.delete("poolProbe");

  let fallbackCount = 0;
  const originalFallbackToWebAudio = audio.fallbackToWebAudio;
  audio.fallbackToWebAudio = () => { fallbackCount += 1; };
  audio.htmlPools.set("rejectProbe", [{
    currentTime: 0,
    muted: false,
    volume: 1,
    paused: true,
    ended: false,
    play() { return Promise.reject(new Error("simulated mobile HTMLAudio rejection")); },
  }]);
  audio.htmlPoolIndexes.set("rejectProbe", 0);
  audio.playHtml("rejectProbe", 0.12);
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  check("html-rejection-routes-to-webaudio", fallbackCount === 1, String(fallbackCount));
  audio.fallbackToWebAudio = originalFallbackToWebAudio;
  audio.htmlPools.delete("rejectProbe");
  audio.htmlPoolIndexes.delete("rejectProbe");

  const poolsBeforeStop = audio.htmlPools;
  const contextBeforeStop = audio.context;
  const htmlUnlockedBeforeStop = audio.htmlUnlocked;
  audio.stopAllLoops();
  check(
    "stop-loops-preserves-one-shot-backends",
    audio.htmlPools === poolsBeforeStop && audio.context === contextBeforeStop &&
      audio.htmlUnlocked === htmlUnlockedBeforeStop,
  );

  const originalAudioPlay = audio.play;
  const flightAudioCalls = [];
  audio.play = (name) => flightAudioCalls.push(name);
  game.debugBeginFlight("sword");
  game.debugBeginFlight("propeller", "cat");
  check(
    "sword-start-remains-single-one-shot",
    flightAudioCalls.length === 1 && flightAudioCalls[0] === "swordStart" && audio.loops.size === 0,
    flightAudioCalls.join(","),
  );
  audio.play = originalAudioPlay;
  game.resetState();

  game.running = false;

  game.previousCameraY = 100;
  game.cameraY = 200;
  game.render(0.25);
  check("camera-render-interpolation", Math.abs(game.renderCameraY - 125) < 0.001, String(game.renderCameraY));
  check(
    "world-render-uses-interpolated-camera",
    Math.abs(game.worldToScreenY(250) - (game.logicalHeight - 125)) < 0.001,
    String(game.worldToScreenY(250)),
  );
  game.previousCameraY = game.cameraY;

  const platformListReference = game.platforms;
  const medalListReference = game.medals;
  const enemyListReference = game.enemies;
  const bulletListReference = game.bullets;
  game.ensureWorld();
  check(
    "world-cleanup-compacts-in-place",
    game.platforms === platformListReference &&
      game.medals === medalListReference &&
      game.enemies === enemyListReference &&
      game.bullets === bulletListReference,
  );

  const probeMedia = {
    currentTime: 0,
    loop: false,
    volume: 0,
    setAttribute() {},
    play() { return Promise.resolve(); },
    pause() {},
  };
  audio.htmlTemplates.set("volumeProbeLoop", { cloneNode: () => probeMedia });
  audio.startHtmlLoop("volumeProbe", 0.06);
  const firstProbeLoop = audio.loops.get("volumeProbe");
  audio.startLoop("volumeProbe", 0.06);
  check(
    "duplicate-loop-prevented",
    audio.loops.size === 1 && audio.loops.get("volumeProbe") === firstProbeLoop,
    String(audio.loops.size),
  );
  await new Promise((resolve) => window.setTimeout(resolve, 230));
  check("html-loop-volume-matches-request", Math.abs(probeMedia.volume - 0.06) < 0.005, String(probeMedia.volume));
  audio.stopLoop("volumeProbe", 0);
  audio.htmlTemplates.delete("volumeProbeLoop");

  check("character-two-selectable", game.selectCharacter("character2"));
  await game.start();
  check("character-two-active", game.selectedCharacter === "character2", game.selectedCharacter);
  check("character-two-image-loaded", Boolean(game.images.playerNormal?.complete));
  game.running = false;
  game.selectCharacter("character1");
  await game.start();
  game.running = false;

  const pickupPlatform = game.makePlatform(120, 100, "propeller", 20);
  game.platforms = [pickupPlatform];
  game.lastRoutePlatform = pickupPlatform;
  game.generatedCount = 20;
  game.generateNextPlatform();
  const platformAfterPickup = game.platforms.at(-1);
  check(
    "pickup-overhead-clearance",
    platformAfterPickup.y - pickupPlatform.y >= config.pickupClearanceGap,
    String(platformAfterPickup.y - pickupPlatform.y),
  );
  check(
    "pickup-overhead-platform-is-side-offset",
    Math.abs(
      platformAfterPickup.x + platformAfterPickup.width / 2 -
        (pickupPlatform.x + pickupPlatform.width / 2),
    ) >= config.pickupHorizontalClearance - 0.001,
    String(
      Math.abs(
        platformAfterPickup.x + platformAfterPickup.width / 2 -
          (pickupPlatform.x + pickupPlatform.width / 2),
      ),
    ),
  );
  game.enemies = [];
  game.maybeSpawnEnemy(pickupPlatform, 20);
  check("pickup-platform-has-no-enemy-blocker", game.enemies.length === 0);

  const originalEnsureWorld = game.ensureWorld;
  game.ensureWorld = () => {};
  game.logicalHeight = 1000;
  game.cameraY = 0;
  game.previousCameraY = 0;
  game.platforms = [game.makePlatform(0, 100, "normal", 1)];
  game.platforms[0].width = config.logicalWidth;
  game.medals = [];
  game.enemies = [];
  game.bullets = [];
  game.effects = [];
  game.pickupTransition = null;
  Object.assign(game.player, {
    x: 200,
    y: 100,
    previousX: 200,
    previousY: 100,
    vx: 0,
    vy: config.normalJumpVelocity,
    state: "normal",
    shield: null,
  });
  let bounces = 0;
  let maximumSnapError = 0;
  let previousVelocity = game.player.vy;
  for (let step = 0; step < 5000 && bounces < 30; step += 1) {
    game.update(config.fixedStep);
    if (previousVelocity < 0 && game.player.vy > 0) {
      bounces += 1;
      maximumSnapError = Math.max(maximumSnapError, Math.abs(game.player.y - 100));
    }
    previousVelocity = game.player.vy;
  }
  check("thirty-continuous-landings", bounces === 30, `bounces=${bounces}`);
  check("landing-snap-anchor", maximumSnapError < 0.001, `error=${maximumSnapError}`);

  Object.assign(game.player, {
    x: 200,
    y: 145,
    previousX: 200,
    previousY: 145,
    vx: 0,
    vy: -3200,
    state: "normal",
  });
  game.update(config.fixedStep);
  check(
    "high-speed-swept-landing",
    game.player.vy > 0 && Math.abs(game.player.y - 100) < 0.001,
    `y=${game.player.y},vy=${game.player.vy}`,
  );

  Object.assign(game.player, {
    x: 200,
    y: 180,
    previousX: 200,
    previousY: 180,
    vx: 0,
    vy: -260,
    state: "normal",
    shield: null,
  });
  game.debugBeginFlight("propeller", "cat");
  game.update(config.fixedStep);
  const firstFlightVelocity = game.player.vy;
  let maximumFlightStep = 0;
  let priorY = game.player.y;
  for (let step = 0; step < Math.ceil(3.4 / config.fixedStep); step += 1) {
    game.update(config.fixedStep);
    maximumFlightStep = Math.max(maximumFlightStep, Math.abs(game.player.y - priorY));
    priorY = game.player.y;
  }
  check(
    "propeller-eased-entry",
    firstFlightVelocity > -260 && firstFlightVelocity < config.propellerFlightSpeed,
    String(firstFlightVelocity),
  );
  check("propeller-returns-normal", game.player.state === "normal", game.player.state);
  check(
    "propeller-continuous-position",
    maximumFlightStep < config.propellerFlightSpeed * config.fixedStep * 1.15,
    String(maximumFlightStep),
  );

  Object.assign(game.player, {
    x: 200,
    y: 180,
    previousX: 200,
    previousY: 180,
    vx: 0,
    vy: 0,
    state: "normal",
    shield: null,
  });
  game.enemies = [{ id: 9999, x: 200, y: 220, kind: "spider", consumed: false }];
  game.debugActivateShield("buns");
  game.updateEnemyCollisions();
  check("shield-one-hit", game.enemies[0].consumed && game.player.state === "normal");
  check("shield-flash-then-fade", game.player.shield?.phase === "flash", game.player.shield?.phase);

  game.ensureWorld = originalEnsureWorld;
  const visiblePlatformCounts = [];
  for (let restart = 0; restart < 20; restart += 1) {
    await game.start();
    visiblePlatformCounts.push(
      game.platforms.filter(
        (platform) => platform.y >= game.cameraY && platform.y <= game.cameraY + game.logicalHeight,
      ).length,
    );
  }
  game.running = false;
  check(
    "twenty-mobile-restarts-keep-eleven-to-twelve-visible-platforms",
    visiblePlatformCounts.every((count) => count >= 11 && count <= 12),
    visiblePlatformCounts.join(","),
  );

  const failed = results.filter((result) => !result.passed);
  const report = document.createElement("pre");
  report.id = "smoke-results";
  report.dataset.failed = String(failed.length);
  report.textContent = JSON.stringify(results, null, 2);
  report.style.cssText =
    "position:fixed;inset:0;z-index:9999;overflow:auto;margin:0;padding:16px;background:#fff;color:#111;font:12px monospace;white-space:pre-wrap";
  document.body.appendChild(report);
  document.title = failed.length ? `FAIL ${failed.length} - Zhuya Smoke` : "PASS - Zhuya Smoke";
  window.__ZHUYA_TEST_RESULTS = results;
});

