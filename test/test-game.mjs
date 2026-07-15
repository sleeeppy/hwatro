// index.html의 ENGINE 구간을 추출해 단위 테스트 + 풀런 시뮬레이션 (v2: 12판·계절·밤낮·고 무제한)
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8');
const startMark = html.indexOf('==== ENGINE START ====');
const codeStart = html.indexOf('*/', startMark) + 2;
const endMark = html.indexOf('==== ENGINE END ====');
const codeEnd = html.lastIndexOf('/*', endMark);
const src = html.slice(codeStart, codeEnd);

const E = new Function(src + `
return { mulberry32, shuffle, buildDeck, CHIP, effType, baseChip, HANDS, HAND_BY_ID,
  ROUNDS, TARGETS, BOSS_ROUNDS, MILD_BOSSES, goMult, goBonus, goTarget, detectHand, detectHandInfo, cardChip,
  combosOf, evaluateHand, JOKERS, JOKER_BY_ID, BOSSES, BOSS_BY_ID, computeScore };`)();

let fails = 0;
const assert = (cond, msg) => {
  if (!cond) { console.error('  FAIL:', msg); fails++; }
  else console.log('  ok:', msg);
};
const env = (o = {}) => ({ boss: null, jokerIds: [], mitjangChips: 0, ...o });

// ─── 1. 덱 구성 ───────────────────────────────────────────
console.log('[1] 덱 구성');
{
  const d = E.buildDeck();
  assert(d.length === 48, '48장');
  const n = (t) => d.filter((c) => c.type === t).length;
  assert(n('kwang') === 5 && n('yeol') === 9 && n('tti') === 10 && n('ssangpi') === 2 && n('pi') === 22,
    '광5 열9 띠10 쌍피2 피22');
  assert(d.filter((c) => c.tags.includes('godori')).every((c) => [2, 4, 8].includes(c.month)), '고도리 새 2·4·8월');
  assert(E.ROUNDS === 12 && E.TARGETS.length === 12, '12판 · 목표 12개');
  assert(JSON.stringify(E.BOSS_ROUNDS) === '[3,6,9,12]', '박 라운드 3·6·9·12월');
}

// ─── 2. 족보 판정 (회귀) ──────────────────────────────────
console.log('[2] 족보 판정');
{
  const d = E.buildDeck();
  const pick = (p) => d.filter(p);
  const det = E.detectHand;
  const kw = pick((c) => c.type === 'kwang');
  assert(det(kw) === 'ogwang' && det(kw.slice(0, 4)) === 'sagwang', '오광/사광');
  assert(det(pick((c) => c.month === 1)) === 'chongtong', '총통');
  assert(det(pick((c) => c.tags.includes('godori'))) === 'godori', '고도리');
  assert(det(pick((c) => c.tags.includes('hongdan'))) === 'dan', '홍단');
  const pisSameMonth = [...pick((c) => c.type === 'pi' && c.month === 1), ...pick((c) => c.type === 'pi' && [2, 3].includes(c.month)).slice(0, 3)];
  assert(det(pisSameMonth) === 'pi5', '피5 > 같은달2 우선순위');
  // 쌍피=2 환산: 피3 + 쌍피1 = 피 환산 5 → 피5 (카드 4장)
  const pi3 = pick((c) => c.type === 'pi').slice(0, 3);
  const sp = pick((c) => c.type === 'ssangpi')[0];
  assert(det([...pi3, sp]) === 'pi5', '쌍피=2 환산으로 피3+쌍피1 → 피5');
}

// ─── 3. 계절(이달의 패) + 밤일낮장 ────────────────────────
console.log('[3] 계절 · 밤낮 보정');
{
  const d = E.buildDeck();
  const pick = (p) => d.filter(p);
  const m1kwang = pick((c) => c.month === 1 && c.type === 'kwang')[0];
  const m1pi = pick((c) => c.month === 1 && c.type === 'pi')[0];
  const m2tti = pick((c) => c.month === 2 && c.type === 'tti')[0];

  assert(E.cardChip(m1kwang, env()) === 12, '보정 없음: 광 12');
  assert(E.cardChip(m1kwang, env({ seasonMonth: 1 })) === 24, '이달의 패: 광 12→24');
  assert(E.cardChip(m1kwang, env({ seasonMonth: 1, night: false })) === 26, '낮: 광 24+2=26');
  assert(E.cardChip(m1kwang, env({ seasonMonth: 2, night: true })) === 12, '밤은 광에 보너스 없음');
  assert(E.cardChip(m1pi, env({ seasonMonth: 1, night: true })) === 6, '이달+밤: 피 2×2+2=6');
  assert(E.cardChip(m2tti, env({ seasonMonth: 1, night: true })) === 8, '밤: 띠 6+2=8');
  assert(E.cardChip(m1pi, env({ seasonMonth: 1, night: true, boss: 'pibak' })) === 0, '피박은 계절 보정도 0으로');
  assert(E.cardChip(m1pi, env({ seasonMonth: 1, night: true, boss: 'pibak', jokerIds: ['pibak_boheom'] })) === 6, '피박보험 시 보정 복구');

  // computeScore 통합: 1월 피 2장(이달), 낮 → month2 = (4 + 4) × 2 = 16 (족보 기본칩 없음)
  const m1pis = pick((c) => c.month === 1 && c.type === 'pi');
  const r = E.computeScore(m1pis, env({ seasonMonth: 1, night: false }));
  assert(r.handId === 'month2' && r.score === 16, `계절 통합 16점 (실제 ${r.score})`);
}

// ─── 3.5 코어/플랫 분리 (족보 구성 카드만 배수) ────────────
console.log('[3.5] 코어/플랫 분리');
{
  const d = E.buildDeck();
  const pick = (p) => d.filter(p);
  // 삼광(비광 제외) + 피 2장: (광12×3)×5 + 피2×2 = 180 + 4 = 184
  const kw3 = pick((c) => c.type === 'kwang' && !c.tags.includes('bikwang')).slice(0, 3);
  const pi2 = pick((c) => c.type === 'pi' && c.month === 5);
  const r = E.computeScore([...kw3, ...pi2], env());
  assert(r.handId === 'samgwang' && r.flat === 4 && r.score === 184,
    `삼광+피2 = 184점, flat 4 (실제 ${r.score}, flat ${r.flat})`);
  // 코어만 낼 때는 flat 0
  const r2 = E.computeScore(kw3, env());
  assert(r2.flat === 0 && r2.score === 36 * 5, `삼광만 = 180 (실제 ${r2.score})`);
  // month2 짝 2개면 기본칩 합 높은 쪽이 코어
  const m1 = pick((c) => c.month === 1 && c.type !== 'kwang').slice(0, 2); // 띠6+피2 = 8
  const m11 = pick((c) => c.month === 11 && c.type !== 'kwang').slice(0, 2); // 쌍피5+피2 = 7
  const info = E.detectHandInfo([...m1, ...m11]);
  assert(info.handId === 'month2' && info.core.every((c) => c.month === 1), 'month2 짝 2개 → 칩 높은 1월 코어');
  // 무조합은 전부 코어 (flat 0, 배수 1)
  const noneCards = [pick((c) => c.month === 1 && c.type === 'kwang')[0], pick((c) => c.month === 2 && c.type === 'pi')[0]];
  const r3 = E.computeScore(noneCards, env());
  assert(r3.handId === 'none' && r3.flat === 0 && r3.score === 12 + 2, `무조합 카드합 (실제 ${r3.score}, flat ${r3.flat})`);
  // 열끗 5장: 코어 3장만 배수, 나머지 2장은 flat
  const yeol5 = pick((c) => c.type === 'yeol' && !c.tags.includes('dual')).slice(0, 5);
  const ry = E.computeScore(yeol5, env());
  assert(ry.handId === 'yeol3' && ry.flat === 16 && ry.score === 8 * 3 * 3 + 16,
    `열끗5 = (24)×3 + 16 = 88 (실제 score ${ry.score}, flat ${ry.flat})`);
}

// ─── 4. 고 무제한 공식 ────────────────────────────────────
console.log('[4] 고 무제한');
{
  assert(E.goMult(1) === 1.5 && E.goMult(2) === 2 && E.goMult(4) === 3 && E.goMult(6) === 4, 'goMult 1.5/2/3/4');
  assert(E.goBonus(1) === 4 && E.goBonus(2) === 10 && E.goBonus(3) === 18 && E.goBonus(4) === 28 && E.goBonus(5) === 40,
    'goBonus 4/10/18/28/40');
  // 고 목표: max(기본 공식, 현재 점수 + 기본 목표 25%) — 연쇄 고 발생 불가
  assert(E.goTarget(320, 1, 330) === 480, '오버슛 작으면 기본 공식 (480)');
  assert(E.goTarget(320, 1, 700) === 780, '오버슛 크면 점수+25% 바닥 (700+80)');
  for (const [base, n, score] of [[320, 1, 330], [320, 1, 700], [320, 2, 640], [7400, 3, 30000], [100, 5, 351]])
    assert(E.goTarget(base, n, score) > score, `goTarget(${base},${n},${score}) > 현재 점수`);
}

// ─── 5. 특수패·박 (회귀 축약) ─────────────────────────────
console.log('[5] 특수패·박 회귀');
{
  const d = E.buildDeck();
  const pick = (p) => d.filter(p);
  const hong = pick((c) => c.tags.includes('hongdan'));
  assert(E.computeScore(hong, env({ jokerIds: ['dangol'] })).mult === 10, '단골 dan +6배수');
  const m1pi2 = pick((c) => c.month === 1 && c.type === 'pi');
  assert(E.computeScore(m1pi2, env({ jokerIds: ['heundeulgi'] })).mult === 3, '흔들기 ×1.5');
  assert(E.computeScore(m1pi2, env({ jokerIds: ['heundeulgi'], boss: 'no_shake' })).handId === 'none', 'no_shake 강등');
  const guk = pick((c) => c.tags.includes('dual'))[0];
  guk.asPi = true;
  assert(E.computeScore([guk], env({ boss: 'meongbak' })).chips === 5, '국진 쌍피 모드 멍박 면제');
  guk.asPi = false;
}

// ─── 6. evaluateHand (춘향 훈수 엔진) ─────────────────────
console.log('[6] evaluateHand');
{
  const d = E.buildDeck();
  const pick = (p) => d.filter(p);
  const hand = [...pick((c) => c.tags.includes('hongdan')), ...pick((c) => c.type === 'pi').slice(0, 5)];
  const best = E.evaluateHand(hand, env());
  assert(best && best.handId === 'dan', `최적 조합 = 홍단 (실제 ${best.handId})`);
  // 뒷면 제외
  hand[0].faceDown = true;
  const best2 = E.evaluateHand(hand, env());
  assert(best2.handId !== 'dan', '뒷면 카드는 후보에서 제외');
  hand[0].faceDown = false;
  // 국진 모드 자동 탐색: 열끗2 + 국진 → 열끗셋이 최적이면 gukAsPi=false 선택
  const guk = pick((c) => c.tags.includes('dual'))[0];
  const y2 = pick((c) => c.type === 'yeol' && !c.tags.includes('dual')).slice(0, 2);
  const best3 = E.evaluateHand([guk, ...y2], env());
  assert(best3.handId === 'yeol3' && best3.gukAsPi === false, '국진 양모드 탐색 → 열끗 모드 선택');
  assert(guk.asPi === false, 'evaluateHand 후 국진 상태 원복');
}

// ─── 7. 풀런 시뮬레이션 (12판 · 계절 · 밤낮) ──────────────
console.log('[7] 풀런 시뮬레이션');
{
  function simulate(seed, buyAI) {
    const rng = E.mulberry32(seed);
    let money = 4, jokers = [], mitjangChips = 0;
    const usedBosses = [];
    for (let round = 1; round <= E.ROUNDS; round++) {
      let boss = null;
      if (E.BOSS_ROUNDS.includes(round)) {
        const pool = (round === 3 ? E.MILD_BOSSES : E.BOSSES.map((b) => b.id)).filter((id) => !usedBosses.includes(id));
        boss = pool[Math.floor(rng() * pool.length)];
        usedBosses.push(boss);
      }
      const deck = E.shuffle(E.buildDeck(), rng);
      let hand = [];
      const refill = () => { while (hand.length < 8 && deck.length) hand.push(deck.pop()); };
      refill();
      let score = 0, playsLeft = 4, discardsLeft = boss === 'bibaram' ? 0 : 4;
      const target = E.TARGETS[round - 1];
      const e = () => ({ boss, jokerIds: jokers, mitjangChips, seasonMonth: round, night: round % 2 === 0 });

      while (playsLeft > 0 && score < target) {
        let best = E.evaluateHand(hand, e());
        const need = (target - score) / playsLeft;
        if (discardsLeft > 0 && best.score < need && deck.length > 0) {
          const keep = new Set(best.cards.map((c) => c.uid));
          const junk = hand.filter((c) => !keep.has(c.uid)).sort((a, b) => E.baseChip(a) - E.baseChip(b)).slice(0, 3);
          if (junk.length) {
            discardsLeft--;
            if (jokers.includes('mitjang')) mitjangChips += 8;
            hand = hand.filter((c) => !junk.includes(c));
            refill();
            best = E.evaluateHand(hand, e());
          }
        }
        score += best.score;
        const ids = new Set(best.cards.map((c) => c.uid));
        hand = hand.filter((c) => !ids.has(c.uid));
        playsLeft--;
        refill();
        if (hand.length > 8) throw new Error('손패 8장 초과');
      }
      if (score < target) return { cleared: round - 1 };
      const interest = Math.min(Math.floor(money / 5), 5);
      money += interest + (E.BOSS_ROUNDS.includes(round) ? 6 : 4) + playsLeft + (jokers.includes('pibak_boheom') ? 1 : 0);
      if (round < E.ROUNDS && buyAI) {
        const pool = E.JOKERS.filter((j) => !jokers.includes(j.id));
        E.shuffle(pool, rng);
        const offers = pool.slice(0, 3).sort((a, b) => a.price - b.price);
        for (const o of offers) if (jokers.length < 5 && money >= o.price + 2) { money -= o.price; jokers.push(o.id); }
      }
    }
    return { cleared: E.ROUNDS };
  }

  const N = 150;
  const hist = { shop: Array(13).fill(0), noShop: Array(13).fill(0) };
  let errors = 0;
  for (let s = 1; s <= N; s++) {
    try {
      hist.shop[simulate(s * 7919, true).cleared]++;
      hist.noShop[simulate(s * 104729, false).cleared]++;
    } catch (err) { errors++; console.error('  SIM ERROR seed', s, err.message); }
  }
  assert(errors === 0, `시뮬레이션 ${N * 2}런 무오류`);
  const cum = (h) => h.map((_, i) => h.slice(i).reduce((a, b) => a + b, 0));
  const pct = (arr) => arr.map((v) => Math.round((v / N) * 100)).join(' ');
  console.log('  [상점O] n판 이상 클리어 % (0~12):', pct(cum(hist.shop)));
  console.log('  [상점X] n판 이상 클리어 % (0~12):', pct(cum(hist.noShop)));
  const c0 = cum(hist.noShop), c1 = cum(hist.shop);
  assert(c0[1] / N >= 0.8 && c0[1] / N <= 1.0, `무조커 1월 통과율 80~100% (실제 ${Math.round((c0[1] / N) * 100)}%)`);
  assert(c0[4] / N <= 0.25, `무조커 4월 이상 ≤25% — 상향된 난이도 (실제 ${Math.round((c0[4] / N) * 100)}%)`);
  assert(c1[12] / N <= 0.15, `단순 봇 승리율 ≤15% (실제 ${Math.round((c1[12] / N) * 100)}%)`);
}

console.log(fails === 0 ? '\n✅ 전체 테스트 통과' : `\n❌ ${fails}개 실패`);
process.exitCode = fails === 0 ? 0 : 1;
