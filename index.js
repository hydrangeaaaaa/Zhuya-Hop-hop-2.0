/* global ZhuyaAudio, ZhuyaGame */
document.addEventListener("DOMContentLoaded", () => {
  "use strict";

  const startView = document.querySelector("#start-view");
  const gameView = document.querySelector("#game-view");
  const gameOverView = document.querySelector("#game-over-view");
  const startButton = document.querySelector("#start-button");
  const restartButton = document.querySelector("#restart-button");
  const homeButton = document.querySelector("#home-button");
  const musicButton = document.querySelector("#music-button");
  const scoreValue = document.querySelector("#score-value");
  const finalScoreTop = document.querySelector("#final-score-top");
  const finalScoreMain = document.querySelector("#final-score-main");
  const permissionNote = document.querySelector("#permission-note");
  const shootButton = document.querySelector("#shoot-button");
  const characterPreviewImage = document.querySelector("#character-preview-image");
  const characterOptions = [...document.querySelectorAll(".character-option")];
  const canvas = document.querySelector("#game-canvas");

  const audio = new ZhuyaAudio();
  let noteTimer = 0;
  const showNote = (message) => {
    window.clearTimeout(noteTimer);
    permissionNote.textContent = message;
    permissionNote.classList.add("is-visible");
    noteTimer = window.setTimeout(() => permissionNote.classList.remove("is-visible"), 2200);
  };

  const showView = (view) => {
    for (const current of [startView, gameView, gameOverView]) {
      current.classList.toggle("is-active", current === view);
    }
  };

  const game = new ZhuyaGame(canvas, {
    audio,
    onScore(score) {
      scoreValue.textContent = String(score);
    },
    onGameOver(score) {
      finalScoreTop.textContent = String(score);
      finalScoreMain.textContent = String(score);
      showView(gameOverView);
    },
    onControlMode(mode) {
      showNote(mode === "tilt" ? "重力感应已启用" : "触控模式：左右移动，底部圆点射击");
    },
  });

  const selectCharacter = (characterId) => {
    if (!game.selectCharacter(characterId)) return;
    for (const option of characterOptions) {
      const selected = option.dataset.character === characterId;
      option.classList.toggle("is-selected", selected);
      option.setAttribute("aria-checked", String(selected));
    }
    characterPreviewImage.src = `assets/${characterId}/player-normal.png`;
  };

  for (const option of characterOptions) {
    option.addEventListener("click", () => selectCharacter(option.dataset.character));
  }

  const startGame = async (requestMotion) => {
    const audioPromise = audio.unlock().catch(() => false);
    const motionPromise = requestMotion
      ? game.requestOrientationPermission().catch(() => false)
      : Promise.resolve(game.tilt.permission);
    showView(gameView);
    try {
      await game.start();
      const [audioReady, motionGranted] = await Promise.all([audioPromise, motionPromise]);
      musicButton.dataset.audioState = audioReady ? "running" : "blocked";
      musicButton.dataset.audioBackend = audio.backend;
      if (audioReady) audio.play("start", 0.2);
      else showNote("声音未开启，可点右上角 MUSIC 重试");
      if (!motionGranted) showNote("触控模式：左右移动，底部圆点射击");
    } catch (error) {
      console.error(error);
      showNote("素材加载失败，请刷新后重试");
      showView(startView);
    }
  };

  const primeAudio = () => audio.primeFromGesture();
  startButton.addEventListener("pointerdown", primeAudio, { passive: true });
  restartButton.addEventListener("pointerdown", primeAudio, { passive: true });
  musicButton.addEventListener("pointerdown", () => audio.primeFromGesture(true), { passive: true });
  startButton.addEventListener("click", () => startGame(true));
  restartButton.addEventListener("click", () => startGame(false));
  homeButton.addEventListener("click", () => {
    game.stop();
    showView(startView);
  });
  musicButton.addEventListener("click", async () => {
    if (!audio.isReady()) {
      const ready = await audio.unlock().catch(() => false);
      if (!ready) {
        showNote("浏览器暂未允许声音，请再点一次 MUSIC");
        return;
      }
      audio.setEnabled(true);
      musicButton.dataset.audioState = "running";
      musicButton.dataset.audioBackend = audio.backend;
      audio.play("start", 0.18);
    } else {
      audio.setEnabled(!audio.enabled);
    }
    musicButton.classList.toggle("is-muted", !audio.enabled);
    if (audio.enabled) game.restoreActiveLoop();
  });

  const endShootPointer = (event) => {
    event.preventDefault();
    game.endExternalPointer(event.pointerId);
    shootButton.classList.remove("is-pressed");
    if (shootButton.hasPointerCapture?.(event.pointerId)) {
      shootButton.releasePointerCapture(event.pointerId);
    }
  };
  shootButton.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    shootButton.setPointerCapture?.(event.pointerId);
    shootButton.classList.add("is-pressed");
    game.beginExternalPointer(event.pointerId, "shoot");
  }, { passive: false });
  shootButton.addEventListener("pointerup", endShootPointer, { passive: false });
  shootButton.addEventListener("pointercancel", endShootPointer, { passive: false });

  game.load().catch((error) => console.error("Asset preload failed", error));
  window.__zhuyaGame = game;
  window.__zhuyaAudio = audio;
});
