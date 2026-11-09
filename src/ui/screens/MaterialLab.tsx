import { useEffect, useRef, useState } from 'preact/hooks';
import { Button, Seg, Tabs } from '../kit';
import { back } from '../router';
import { useStore } from '../../state/store';
import { settingsStore, patchSettings } from '../../state/settings';
import { TableScene } from '../../scene/TableScene';
import { stageDemo } from '../../scene/demo';
import { generateTexture, toObjectURL } from '../../scene/textures/textureClient';
import { drawCardBack, drawCardFace, CARD_W, CARD_H } from '../../scene/textures/cardArt';
import { drawChipCap } from '../../scene/textures/chipArt';
import { CARD_BACK_NAMES, CHIP_SETS, DENOMS } from '../../scene/catalog';
import { WEAR_LEVEL } from '../../scene/materials';

type LabTab = 'table' | 'textures' | 'cards' | 'chips';

function TableView() {
  const ref = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<TableScene | null>(null);
  const s = useStore(settingsStore);
  const [status, setStatus] = useState('Building…');
  useEffect(() => {
    const sc = new TableScene(ref.current!, settingsStore.get(), settingsStore.get().gameplay.players);
    sceneRef.current = sc;
    (window as any).__lab = sc;
    sc.init((p, l) => setStatus(`${l} ${Math.round(p * 100)}%`)).then(() => {
      stageDemo(sc);
      setStatus('');
      (window as any).__labReady = true;
    });
    return () => {
      (window as any).__labReady = false;
      sc.dispose();
    };
  }, []);
  useEffect(() => {
    const sc = sceneRef.current;
    if (!sc || status) return;
    (window as any).__labReady = false;
    void sc.applyLook(s).then(() => ((window as any).__labReady = true));
  }, [s.look, s.access.colorblind]);
  return (
    <div style={{ position: 'relative', flex: 1, minHeight: '300px', borderRadius: '10px', overflow: 'hidden' }} class="inset">
      <canvas ref={ref} data-testid="lab-canvas" style={{ display: 'block', width: '100%', height: '100%' }} />
      {status && <div class="embossed" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{status}</div>}
      <div class="vignette" />
    </div>
  );
}

function TexturePreviews() {
  const s = useStore(settingsStore);
  const [imgs, setImgs] = useState<{ label: string; url: string }[]>([]);
  useEffect(() => {
    let alive = true;
    const wear = WEAR_LEVEL[s.look.wear];
    (async () => {
      const out: { label: string; url: string }[] = [];
      const add = async (label: string, kind: any, w: number, h: number, opts: object) => {
        const r = await generateTexture(kind, w, h, opts);
        out.push({ label: `${label} — color`, url: await toObjectURL(r.color) });
        if (r.normal) out.push({ label: `${label} — normal`, url: await toObjectURL(r.normal) });
        if (r.rough) out.push({ label: `${label} — roughness`, url: await toObjectURL(r.rough) });
        if (alive) setImgs([...out]);
      };
      await add(`Wood (${s.look.wood})`, 'wood', 512, 256, { type: s.look.wood, wear, seed: 11 });
      await add('Felt', 'felt', 256, 256, { color: s.look.felt, wear, seed: 21 });
      await add('Leather rail', 'leather', 512, 256, { color: s.look.leather, wear, seed: 31, stitches: [0.08, 0.92], stitchColor: '#d8c29a' });
      await add(`Metal (${s.look.trim})`, 'metal', 256, 256, { tint: s.look.trim, wear, seed: 41 });
      await add('Paper', 'paper', 256, 256, { wear, seed: 7 });
      await add('Clay', 'clay', 256, 64, { seed: 61, wear });
    })();
    return () => {
      alive = false;
    };
  }, [s.look.wood, s.look.felt, s.look.leather, s.look.trim, s.look.wear]);
  return (
    <div class="grid2" data-testid="lab-textures">
      {imgs.map((i) => (
        <figure key={i.label} style={{ margin: 0 }}>
          <img src={i.url} alt={i.label} style={{ width: '100%', imageRendering: 'auto', borderRadius: '6px', boxShadow: '0 4px 10px rgba(0,0,0,.6)' }} />
          <figcaption class="muted" style={{ fontSize: '12px', marginTop: '4px' }}>{i.label}</figcaption>
        </figure>
      ))}
    </div>
  );
}

function CardGallery() {
  const s = useStore(settingsStore);
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext('2d')!;
    const wear = WEAR_LEVEL[s.look.wear];
    void document.fonts?.load?.('700 40px "Playfair Display"').finally(() => {
      ctx.clearRect(0, 0, c.width, c.height);
      const faces = [48, 45, 41, 37, 50, 47, 43, 39, 49, 46, 42, 38, 51, 44, 40, 36, 0, 13, 26, 34];
      faces.forEach((f, i) => {
        const x = (i % 10) * (CARD_W + 12) + 6,
          y = Math.floor(i / 10) * (CARD_H + 12) + 6;
        drawCardFace(ctx, f, x, y, { style: s.access.colorblind ? 'four' : s.look.deckStyle, wear, seed: 3 });
      });
      CARD_BACK_NAMES.forEach((_, i) => {
        const x = (i % 10) * (CARD_W + 12) + 6,
          y = 2 * (CARD_H + 12) + Math.floor(i / 10) * (CARD_H + 12) + 6;
        drawCardBack(ctx, i, x, y, wear, 5);
      });
    });
  }, [s.look.deckStyle, s.look.wear, s.access.colorblind]);
  return <canvas ref={ref} width={10 * (CARD_W + 12)} height={4 * (CARD_H + 12)} style={{ width: '100%', background: '#1f6b3f', borderRadius: '8px' }} data-testid="lab-cards" />;
}

function ChipGallery() {
  const s = useStore(settingsStore);
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext('2d')!;
    void document.fonts?.load?.('700 40px "Playfair Display"').finally(() => {
      ctx.clearRect(0, 0, c.width, c.height);
      CHIP_SETS.forEach((set, si) =>
        DENOMS.forEach((d, i) => drawChipCap(ctx, i * 130 + 4, si * 134 + 4, 124, d, set[d], WEAR_LEVEL[s.look.wear], i)),
      );
    });
  }, [s.look.wear]);
  return <canvas ref={ref} width={DENOMS.length * 130 + 8} height={CHIP_SETS.length * 134 + 8} style={{ width: '100%', background: '#1f6b3f', borderRadius: '8px' }} data-testid="lab-chips" />;
}

export function MaterialLab() {
  const [tab, setTab] = useState<LabTab>('table');
  const s = useStore(settingsStore);
  return (
    <div class="screen wood-dark" data-testid="material-lab">
      <div class="screen-head">
        <Button onClick={back} label="Back">‹ Back</Button>
        <h1 class="embossed">Material Lab</h1>
      </div>
      <Tabs tabs={[{ id: 'table', label: '3D Table' }, { id: 'textures', label: 'Textures' }, { id: 'cards', label: 'Cards' }, { id: 'chips', label: 'Chips' }]} value={tab} onChange={setTab} />
      <div class="panel wood" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '10px', padding: '12px', minHeight: 0 }}>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <Seg label="Wood" value={s.look.wood} onChange={(v) => patchSettings('look', { wood: v })} options={[{ value: 'oak', label: 'Oak' }, { value: 'walnut', label: 'Walnut' }, { value: 'mahogany', label: 'Mahogany' }, { value: 'ebony', label: 'Ebony' }]} />
          <Seg label="Wear" value={s.look.wear} onChange={(v) => patchSettings('look', { wear: v })} options={[{ value: 'new', label: 'New' }, { value: 'light', label: 'Light' }, { value: 'worn', label: 'Worn' }, { value: 'vintage', label: 'Vintage' }]} />
          {tab === 'table' && <Seg label="Shape" value={s.look.tableShape} onChange={(v) => patchSettings('look', { tableShape: v })} options={[{ value: 'oval', label: 'Oval' }, { value: 'round', label: 'Round' }, { value: 'rect', label: 'Rect' }]} />}
        </div>
        <div class="scroll" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {tab === 'table' && <TableView />}
          {tab === 'textures' && <TexturePreviews />}
          {tab === 'cards' && <CardGallery />}
          {tab === 'chips' && <ChipGallery />}
        </div>
      </div>
    </div>
  );
}
