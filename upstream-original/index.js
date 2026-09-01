// Snapshot of the compact upstream game loop retained for provenance.
// Source: https://github.com/kubowania/Doodle-Jump (master)
// Copyright (c) 2020 Ania Kubow, MIT License.
//
// The original creates five DOM platforms, automatically jumps the doodler,
// detects landings only while falling, shifts platforms downward above a
// threshold, recycles platforms at the top, and ends when the doodler falls.
// The production implementation in ../js/game.js preserves those mechanics
// while moving timing and world coordinates to Canvas 2D.
