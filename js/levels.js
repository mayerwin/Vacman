// Hand-designed rooms. Each cell is 1m on the world grid.
//
//  #  wall
//  .  floor with dirt
//  o  floor (no dirt — used for furniture surrounds, spawn areas)
//  D  exit door (spawned, locked until 100% dirt is collected)
//  S  player spawn cell
//  P  pet spawn cell
//  +  furniture footprint (acts like a wall but rendered differently)
//
// Rooms are read top-down: row 0 is +Z, last row is -Z. Cell (col, row).
//
// Difficulty scales with player count via `difficultyForPlayers()` below.

export const LEVELS = [
  {
    id: "living",
    name: "Living Room",
    floor: "wood",
    mood: { hue: "warm", ambient: 0x37274a, key: 0xffd9a8, fill: 0x6b4cff },
    pets: [{ kind: "cat", count: 2 }, { kind: "hamster", count: 1 }],
    powerups: 4,
    map: [
      "############oooDoooo############",
      "#S............................S#",
      "#..++++..............++++++..#.#",
      "#..+oo+..............+oooo+..#.#",
      "#..+oo+..#####..#....+oooo+....#",
      "#..++++..#...#..#....++++++....#",
      "#........#...#..#..............#",
      "#..####..#####..#......####....#",
      "#..#oo#.........#......#oo#....#",
      "#..####.....P...#......####....#",
      "#......................#####...#",
      "#............................#.#",
      "#S....+++..#####...........+++S#",
      "################################",
    ],
  },
  {
    id: "kitchen",
    name: "Kitchen",
    floor: "tile",
    mood: { hue: "cool", ambient: 0x1d3047, key: 0xc9eaff, fill: 0x00ffc6 },
    pets: [{ kind: "dog", count: 1 }, { kind: "cat", count: 2 }],
    powerups: 5,
    map: [
      "##########Doo##########",
      "#S...................S#",
      "#.+++++++.....+++++++.#",
      "#.+ooooo+.....+ooooo+.#",
      "#.+++++++.....+++++++.#",
      "#......................",
      "#......++++++++++.....#",
      "#......+oooooooo+.....#",
      "#......+oooo  oo+..P..#",
      "#......++++++++++.....#",
      "#......................",
      "#.+++.....######.....#.#",
      "#.+o+.....#....#.....#.#",
      "#.+++.....######.....#.#",
      "#S....................S#",
      "#######################",
    ],
  },
  {
    id: "bedroom",
    name: "Bedroom",
    floor: "carpet",
    mood: { hue: "violet", ambient: 0x2a1c3a, key: 0xff9ad8, fill: 0xb388ff },
    pets: [{ kind: "cat", count: 2 }, { kind: "parrot", count: 1 }],
    powerups: 4,
    map: [
      "##########ooDoo##########",
      "#S......................#",
      "#..+++++++++............#",
      "#..+ooooooo+....++++....#",
      "#..+ooooooo+....+oo+....#",
      "#..+ooooooo+....++++....#",
      "#..+++++++++............#",
      "#............P..........#",
      "#............#####......#",
      "#..++++......#...#......#",
      "#..+oo+......#####...+++#",
      "#..++++..............+o+#",
      "#....................+++#",
      "#S.....................S#",
      "#########################",
    ],
  },
  {
    id: "bathroom",
    name: "Bathroom",
    floor: "tile",
    mood: { hue: "ice", ambient: 0x1a2f3a, key: 0xa0e8ff, fill: 0x38bdf8 },
    pets: [{ kind: "hamster", count: 2 }, { kind: "parrot", count: 1 }],
    powerups: 3,
    map: [
      "########ooDoo########",
      "#S.................S#",
      "#..+++++++.........#",
      "#..+ooooo+.....++..#",
      "#..+ooooo+.....+o..#",
      "#..+ooooo+.....++..#",
      "#..+++++++.........#",
      "#............P.....#",
      "#..####............#",
      "#..#oo#......++++..#",
      "#..####......+oo+..#",
      "#............++++..#",
      "#S.................S#",
      "####################",
    ],
  },
  {
    id: "garage",
    name: "Garage",
    floor: "concrete",
    mood: { hue: "industrial", ambient: 0x222234, key: 0xfff0c2, fill: 0xff8c42 },
    pets: [{ kind: "dog", count: 2 }, { kind: "cat", count: 1 }, { kind: "hamster", count: 1 }],
    powerups: 6,
    map: [
      "##############ooDoo##############",
      "#S..............................S#",
      "#..+++++++++.........+++++++++..#",
      "#..+ooooooo+.........+ooooooo+..#",
      "#..+ooooooo+....P....+ooooooo+..#",
      "#..+++++++++.........+++++++++..#",
      "#................................#",
      "#......####............####......#",
      "#......#oo#............#oo#......#",
      "#......####............####......#",
      "#................................#",
      "#..+++++++++.........+++++++++..#",
      "#..+ooooooo+.........+ooooooo+..#",
      "#..+++++++++.........+++++++++..#",
      "#S..............................S#",
      "##################################",
    ],
  },
  {
    id: "dock",
    name: "Charging Dock",
    floor: "dock",
    mood: { hue: "victory", ambient: 0x14302a, key: 0x00ffc6, fill: 0xff3d8b },
    pets: [],
    powerups: 0,
    isFinal: true,
    map: [
      "##############oo##############",
      "#............................#",
      "#............................#",
      "#............................#",
      "#............................#",
      "#............DOCK............#",
      "#............................#",
      "#S..........................S#",
      "#............................#",
      "##############################",
    ],
  },
];

// Difficulty scaling. Solo runs get 0.6x pets, full lobbies get 1.4x.
export function difficultyForPlayers(playerCount, mode) {
  if (mode === "versus") return 1.0;            // versus uses single room
  if (playerCount <= 1) return 0.7;
  if (playerCount === 2) return 0.9;
  if (playerCount <= 4) return 1.05;
  return 1.25;
}
