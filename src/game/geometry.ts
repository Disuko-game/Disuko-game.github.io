import { BOARD_SIZE, BOX_COUNT, BOX_HEIGHT, BOX_WIDTH } from "./types";

export function isInBounds(row: number, col: number): boolean {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

export function cellKey(row: number, col: number): string {
  return `${row}:${col}`;
}

export function boxIndex(row: number, col: number): number {
  if (!isInBounds(row, col)) {
    throw new Error(`Cell ${row},${col} is outside the Disuko board.`);
  }

  return Math.floor(row / BOX_HEIGHT) * (BOARD_SIZE / BOX_WIDTH) + Math.floor(col / BOX_WIDTH);
}

export function cellsForBox(index: number): Array<{ row: number; col: number }> {
  if (index < 0 || index >= BOX_COUNT) {
    throw new Error(`Box ${index} is outside the Disuko board.`);
  }

  const boxesPerRow = BOARD_SIZE / BOX_WIDTH;
  const rowStart = Math.floor(index / boxesPerRow) * BOX_HEIGHT;
  const colStart = (index % boxesPerRow) * BOX_WIDTH;
  const cells: Array<{ row: number; col: number }> = [];

  for (let row = rowStart; row < rowStart + BOX_HEIGHT; row += 1) {
    for (let col = colStart; col < colStart + BOX_WIDTH; col += 1) {
      cells.push({ row, col });
    }
  }

  return cells;
}
