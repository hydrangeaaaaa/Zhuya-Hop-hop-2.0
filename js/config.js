/* global window */
(function defineConfig(global) {
  "use strict";

  const TIME_TO_APEX = 0.525;
  const NORMAL_JUMP_HEIGHT = 200;
  const GRAVITY = (2 * NORMAL_JUMP_HEIGHT) / (TIME_TO_APEX * TIME_TO_APEX);
  const JUMP_VELOCITY = GRAVITY * TIME_TO_APEX;

  global.ZHUYA_CONFIG = Object.freeze({
    logicalWidth: 400,
    minLogicalHeight: 600,
    maxLogicalHeight: 880,
    maxDevicePixelRatio: 1.5,
    fixedStep: 1 / 60,
    maxFrameDelta: 0.05,
    gravity: GRAVITY,
    normalJumpVelocity: JUMP_VELOCITY,
    normalJumpHeight: NORMAL_JUMP_HEIGHT,
    timeToApex: TIME_TO_APEX,
    springJumpHeight: 380,
    springJumpVelocity: Math.sqrt(2 * GRAVITY * 380),
    horizontalMaxSpeed: 218,
    horizontalAcceleration: 920,
    horizontalDeceleration: 1260,
    tiltDeadZone: 3,
    tiltMaxAngle: 22,
    tiltLowPass: 0.18,
    cameraThreshold: 0.42,
    platformWidth: 85,
    platformHeight: 15,
    platformGapMin: 68,
    platformGapMax: 84,
    platformTopBuffer: 120,
    pickupClearanceGap: 126,
    pickupHorizontalClearance: 98,
    visiblePlatformTarget: 12,
    visiblePlatformMinimum: 11,
    playerVisualHeight: 88,
    playerBodyWidth: 34,
    playerBodyHeight: 68,
    playerFootHalfWidth: 13,
    medalScore: 50,
    medalSpawnRate: 0.14,
    enemySpawnRate: 0.09,
    mainSpawnWeights: Object.freeze({
      normal: 0.78,
      broken: 0.05,
      moving: 0.04,
      spring: 0.05,
      propeller: 0.03,
      shield: 0.03,
      sword: 0.02,
    }),
    springCooldownPlatforms: 3,
    shieldCooldownPlatforms: 6,
    propellerCooldownPlatforms: 8,
    swordCooldownPlatforms: 10,
    sharedFlightCooldownPlatforms: 7,
    maxVisibleFlightPickups: 1,
    maxVisibleSprings: 1,
    maxVisibleMajorSpecials: 3,
    propellerDuration: 3.2,
    propellerFlightSpeed: 340,
    swordDuration: 2.2,
    swordFlightSpeed: 544,
    flightTransitionDuration: 0.18,
    shieldDuration: 7,
    shieldAxesShare: 0.6,
    shieldFadeDuration: 0.2,
    shieldFlashDuration: 0.08,
    springAnimationDuration: 0.245,
    brokenAnimationDuration: 0.32,
    shotCooldown: 0.25,
    bulletSpeed: 470,
    baseScoreBand: 12,
  });

  global.ZHUYA_CHARACTERS = Object.freeze({
    character1: Object.freeze({
      normal: "assets/character1/player-normal.png",
      fall: "assets/character1/player-fall.png",
      fallRotation: 0,
      propeller: Object.freeze({
        cat: "assets/character1/player-propeller-cat.png",
        dog: "assets/character1/player-propeller-dog.png",
      }),
    }),
    character2: Object.freeze({
      normal: "assets/character2/player-normal.png",
      fall: "assets/character2/player-normal.png",
      fallRotation: -0.72,
      propeller: null,
    }),
  });

  global.ZHUYA_ASSETS = Object.freeze({
    background: "assets/platforms/background-original.png",
    platforms: Object.freeze({
      white: "assets/platforms/platform-white.png",
      brown: "assets/platforms/platform-brown.png",
      yellow: "assets/platforms/platform-yellow.png",
      broken: "assets/platforms/platform-blue-broken.png",
    }),
    pickups: Object.freeze({
      propellerCat: "assets/pickups/pickup-propeller-cat.png",
      propellerDog: "assets/pickups/pickup-propeller-dog.png",
      medal: "assets/pickups/medal.png",
    }),
    enemies: Object.freeze({
      crab: "assets/enemies/enemy-crab.png",
      lobster: "assets/enemies/enemy-lobster.png",
      spider: "assets/enemies/enemy-spider.png",
    }),
    shields: Object.freeze({
      axes: "assets/shields/shield-axes.png",
      buns: "assets/shields/shield-buns.png",
    }),
    sword: "assets/rides/sword.png",
    springs: Object.freeze({
      slipper: Object.freeze(
        Array.from({ length: 7 }, (_, index) =>
          `assets/springs/slipper/${String(index + 1).padStart(2, "0")}.png`,
        ),
      ),
      guitar: Object.freeze(
        Array.from({ length: 7 }, (_, index) =>
          `assets/springs/guitar/${String(index + 1).padStart(2, "0")}.png`,
        ),
      ),
    }),
  });
})(window);
