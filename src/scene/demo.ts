// Static showcase arrangement used by the Material Lab and screenshot tests.
import { TableScene } from './TableScene';
import { cardQuat, CARD_SIZE } from './cards';
import { layoutColumns, chipRest } from './stacks';
import { parseCard } from '../engine/cards';

export function stageDemo(scene: TableScene) {
  const L = scene.layout;
  let ci = 0;
  const card = (face: number, x: number, z: number, yaw: number, down: boolean, y = 0.0006) => {
    const c = scene.cards.cards[ci++];
    c.face = face;
    c.visible = true;
    c.pos.set(x, y + ci * 0.00001, z);
    cardQuat(yaw, down, c.quat);
    return c;
  };
  // board
  ['Ah', 'Kd', '7c', 'Ts', 'Qh'].forEach((s, i) => {
    const b = L.board[i];
    card(parseCard(s), b.x + (Math.random() - 0.5) * 0.002, b.z + (Math.random() - 0.5) * 0.002, (Math.random() - 0.5) * 0.03, false);
  });
  // seats
  L.seats.forEach((st, i) => {
    const yaw = Math.atan2(st.inward.x, st.inward.z) + Math.PI;
    const right = { x: -st.inward.z, z: st.inward.x };
    for (let k = 0; k < 2; k++) {
      const off = (k - 0.5) * CARD_SIZE.w * (i === 0 ? 0.62 : 0.35);
      const c = card(i === 0 ? parseCard(k ? 'As' : 'Ks') : -1, st.cards.x + right.x * off, st.cards.z + right.z * off, yaw + (k - 0.5) * (i === 0 ? 0.16 : 0.08) + (Math.random() - 0.5) * 0.05, i !== 0, 0.0006 + k * 0.0005);
      if (i === 0 && k === 1) c.glow = 0.6;
    }
    // stacks
    const amount = [2350, 1875, 4210, 990, 3300, 1500, 2600, 760, 5200][i % 9];
    const cols = layoutColumns(amount, st.stack, st.inward);
    cols.forEach((col, k) => {
      for (let j = 0; j < col.count; j++) {
        const ch = scene.chips.alloc(col.denom);
        if (!ch) return;
        chipRest(col, j, i * 31 + k, 0, ch);
      }
    });
    if (i % 3 === 1) {
      const bet = layoutColumns(150 + i * 25, st.bet, st.inward, 20);
      bet.forEach((col, k) => {
        for (let j = 0; j < col.count; j++) {
          const ch = scene.chips.alloc(col.denom);
          if (ch) chipRest(col, j, 999 + k, 0, ch);
        }
      });
    }
  });
  // pot
  layoutColumns(3725, L.pot, L.dealer.inward, 14).forEach((col, k) => {
    for (let j = 0; j < col.count; j++) {
      const ch = scene.chips.alloc(col.denom);
      if (ch) chipRest(col, j, 555 + k, 0, ch);
    }
  });
  // deck in front of the dealer
  const yawD = Math.atan2(L.dealer.inward.x, L.dealer.inward.z) + Math.PI;
  for (let k = 0; k < 30; k++) card(-1, L.dealer.deck.x + (Math.random() - 0.5) * 0.0008, L.dealer.deck.z + (Math.random() - 0.5) * 0.0008, yawD + Math.PI / 2 + (Math.random() - 0.5) * 0.01, true, 0.0004 + k * 0.00036);
  // buttons
  const b = L.seats[0].button;
  scene.buttons.dealer.position.set(b.x, 0, b.z);
  scene.buttons.dealer.visible = true;
  const s1 = L.seats[1 % L.seats.length].button;
  scene.buttons.sb.position.set(s1.x, 0, s1.z);
  scene.buttons.sb.visible = true;
  const s2 = L.seats[2 % L.seats.length].button;
  scene.buttons.bb.position.set(s2.x, 0, s2.z);
  scene.buttons.bb.visible = true;
  scene.cards.dirty = true;
  scene.chips.dirty = true;
  scene.rig.snap();
  scene.requestRender();
}
