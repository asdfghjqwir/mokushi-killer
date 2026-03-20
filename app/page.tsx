"use client";

import { useState, useCallback } from "react";

// ─── 定数 ────────────────────────────────────────────────────
const MAX_LINES = 500;
const MAX_CHARS_PER_LINE = 500;
const WARN_LINES = 100;

// ─── 揺らぎ吸収ノーマライザー ────────────────────────────────
function normalize(s: string): string {
  s = s.replace(/^[\s\u3000]+|[\s\u3000]+$/g, "");
  s = s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  s = s.replace(/[Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  s = s.replace(/ヶ/g, "ケ");
  const km: Record<string, string> = {
    一:"1",二:"2",三:"3",四:"4",五:"5",六:"6",七:"7",八:"8",九:"9",十:"10",
  };
  s = s.replace(/[一二三四五六七八九十](?=丁目|番|号)/g, (c) => km[c] ?? c);
  s = s.replace(/（株）|㈱|\(株\)/g, "株式会社");
  s = s.replace(/（有）|㈲|\(有\)/g, "有限会社");
  s = s.replace(/株式会社/g, "KK__");
  s = s.replace(/有限会社/g, "YK__");
  s = s.replace(/合同会社/g, "GK__");
  s = s.replace(/[，、,]/g, "");
  s = s.replace(/[－−‐ー]/g, "-");
  s = s.replace(/\s+/g, "");
  s = s.replace(/　/g, "");
  return s;
}

// ─── 表示用ノーマライザー（内部キーを日本語に戻す） ──────────
function normalizeForDisplay(s: string): string {
  let result = normalize(s);
  result = result.replace(/KK__/g, "株式会社");
  result = result.replace(/YK__/g, "有限会社");
  result = result.replace(/GK__/g, "合同会社");
  return result;
}

function findDiffs(a: string, b: string): number[] {
  const diffs: number[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) diffs.push(i);
  }
  return diffs;
}

function validate(left: string, right: string): string | null {
  const lLines = left.split("\n");
  const rLines = right.split("\n");
  if (lLines.length > MAX_LINES || rLines.length > MAX_LINES)
    return `1回の照合は最大 ${MAX_LINES} 行までです。`;
  if ([...lLines, ...rLines].some((l) => l.length > MAX_CHARS_PER_LINE))
    return `1行 ${MAX_CHARS_PER_LINE} 文字を超える行があります。`;
  return null;
}

function exportCSV(rows: RowResult[]) {
  const header = ["行番号", "結果", "比較元（LEFT）", "比較先（RIGHT）", "差分位置"];
  const body = rows.map((r) => {
    const diffStr = r.diffs
      .slice(0, 10)
      .map((p) => `${p + 1}文字目[${r.nl[p] ?? "∅"}→${r.nr[p] ?? "∅"}]`)
      .join(" / ");
    return [r.n, r.ok ? "一致" : "差分あり", r.l, r.r, diffStr].map(
      (v) => `"${String(v).replace(/"/g, '""')}"`
    );
  });
  const csv = [header, ...body].map((row) => row.join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `照合結果_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

type RowResult = {
  n: number; l: string; r: string;
  nl: string; nr: string;
  nld: string; nrd: string; // 表示用（内部キーなし）
  ok: boolean; diffs: number[];
};

const DEMO_LEFT = `東京都千代田区一番町１丁目５
株式会社山田商事　田中太郎
売上金額：１，２３４，５６７円
〒100-0001　東京都千代田区ヶ崎1-2-3
有限会社佐藤工務店
注文番号：ＡＢＣ－００１
大阪市北区角田町１番
納品先：（株）田中製作所
電話番号：０３－１２３４－５６７８`;

const DEMO_RIGHT = `東京都千代田区一番町1丁目5
(株)山田商事　田中太郎
売上金額：1,234,567円
〒100-0001　東京都千代田区ケ崎1-2-3
有限会社佐藤工務店
注文番号：ABC-001
大阪市北区角田町1番
納品先：田中製作所株式会社
電話番号：03-1234-5678`;

const RULES = [
  { label: "数字の表記ゆれ",     desc: "全角「１２３」と半角「123」を同じとみなします" },
  { label: "法人格の表記ゆれ",    desc: "「株式会社」「（株）」「㈱」などを同一視します" },
  { label: "住所の表記ゆれ",      desc: "「ヶ」「ケ」、「一丁目」「1丁目」などを同一視します" },
  { label: "記号・スペースの差異", desc: "全角・半角カンマ、ハイフン、余分なスペースを無視します" },
];

function StepCircle({ num }: { num: number }) {
  return (
    <span className="w-6 h-6 rounded-full bg-slate-900 text-white text-xs font-semibold flex items-center justify-center flex-shrink-0">
      {num}
    </span>
  );
}

export default function MokushiKiller() {
  const [leftText, setLeftText]   = useState("");
  const [rightText, setRightText] = useState("");
  const [results, setResults]     = useState<RowResult[] | null>(null);
  const [stats, setStats]         = useState<{ ok: number; ng: number } | null>(null);
  const [error, setError]         = useState<string | null>(null);
  const [warning, setWarning]     = useState<string | null>(null);
  const [diffOnly, setDiffOnly]   = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  const runCompare = useCallback((l: string, r: string) => {
    setError(null); setWarning(null);
    const err = validate(l, r);
    if (err) { setError(err); return; }
    const lLines = l.split("\n");
    const rLines = r.split("\n");
    const total  = Math.max(lLines.length, rLines.length);
    if (total >= WARN_LINES) setWarning(`${total} 行あります。処理に少し時間がかかる場合があります。`);
    const rows: RowResult[] = [];
    for (let i = 0; i < total; i++) {
      const left  = lLines[i] ?? "";
      const right = rLines[i] ?? "";
      if (left.trim() === "" && right.trim() === "") continue;
      const nl = normalize(left), nr = normalize(right), ok = nl === nr;
      const nld = normalizeForDisplay(left), nrd = normalizeForDisplay(right);
      rows.push({ n: i + 1, l: left, r: right, nl, nr, nld, nrd, ok, diffs: ok ? [] : findDiffs(nl, nr) });
    }
    setResults(rows);
    setStats({ ok: rows.filter((r) => r.ok).length, ng: rows.filter((r) => !r.ok).length });
    setDiffOnly(false);
  }, []);

  const handleClear = () => {
    setLeftText(""); setRightText("");
    setResults(null); setStats(null);
    setError(null); setWarning(null); setDiffOnly(false);
  };

  const displayed = results ? (diffOnly ? results.filter((r) => !r.ok) : results) : [];

  return (
    <div className="min-h-screen bg-slate-50">

      {/* ── ヘッダー ── */}
      <header className="sticky top-0 z-10 bg-white border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-sm font-semibold text-slate-900">テキスト照合ツール</h1>
            <p className="text-xs text-slate-400 mt-0.5 hidden sm:block">2つのテキストを比較して差分を検出</p>
          </div>
          <div className="flex items-center gap-2">
            {/* ヘッダーバッジ：文字色を濃く */}
            <span className="text-xs text-slate-600 bg-slate-100 rounded-md px-2.5 py-1 hidden sm:inline font-medium">
              ブラウザ完結 · データ送信なし
            </span>
            <button
              onClick={() => setShowGuide((v) => !v)}
              className="text-xs text-slate-600 border border-slate-300 rounded-lg px-3 py-1.5 hover:bg-slate-50 transition-colors whitespace-nowrap font-medium"
            >
              {showGuide ? "閉じる" : "使い方"}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-4 sm:space-y-5">

        {/* ── 使い方ガイド ── */}
        {showGuide && (
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 sm:p-5 space-y-4">
            <p className="text-sm font-semibold text-blue-900">このツールの使い方</p>
            <div className="space-y-3">
              {[
                { label: "「比較元」に正しいデータを貼り付ける", desc: "台帳・正式な住所リストなど、基準となるデータを入れてください" },
                { label: "「比較先」に確認したいデータを貼り付ける", desc: "申請書・転記データなど、差分がないか確認したいデータを入れてください" },
                { label: "「照合する」ボタンを押す", desc: "赤い行が差分あり、✓ の行は一致しています" },
              ].map((s, i) => (
                <div key={i} className="flex items-start gap-3">
                  <StepCircle num={i + 1} />
                  <div>
                    <p className="text-sm font-medium text-blue-900">{s.label}</p>
                    <p className="text-xs text-blue-600 mt-0.5">{s.desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t border-blue-100 pt-3">
              <p className="text-xs font-medium text-blue-800 mb-2">自動で吸収してくれる表記ゆれ</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {RULES.map((r) => (
                  <div key={r.label} className="bg-white rounded-lg px-3 py-2 border border-blue-100">
                    <p className="text-xs font-medium text-slate-700">{r.label}</p>
                    <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">{r.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── 入力カード ── */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 sm:p-5 space-y-4 sm:space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <StepCircle num={1} />
                <div>
                  <p className="text-sm font-medium text-slate-700">比較元（マスターデータ）</p>
                  <p className="text-xs text-slate-400">正しいデータ・基準となるデータ</p>
                </div>
              </div>
              <textarea
                className="w-full min-h-36 sm:min-h-44 px-3 py-2.5 font-mono text-sm leading-relaxed resize-y bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-slate-400 focus:bg-white transition-colors placeholder:text-slate-300"
                placeholder="テキストを貼り付けてください&#10;例：住所一覧、法人名リスト"
                value={leftText}
                onChange={(e) => setLeftText(e.target.value)}
                spellCheck={false}
              />
              {leftText && (
                <p className="text-[11px] text-slate-500">{leftText.split("\n").length} 行 入力中</p>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <StepCircle num={2} />
                <div>
                  <p className="text-sm font-medium text-slate-700">比較先（確認データ）</p>
                  <p className="text-xs text-slate-400">差分がないか確認したいデータ</p>
                </div>
              </div>
              <textarea
                className="w-full min-h-36 sm:min-h-44 px-3 py-2.5 font-mono text-sm leading-relaxed resize-y bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-slate-400 focus:bg-white transition-colors placeholder:text-slate-300"
                placeholder="テキストを貼り付けてください&#10;例：申請書から転記したデータ"
                value={rightText}
                onChange={(e) => setRightText(e.target.value)}
                spellCheck={false}
              />
              {rightText && (
                <p className="text-[11px] text-slate-500">{rightText.split("\n").length} 行 入力中</p>
              )}
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-4 py-2.5">
              <span className="font-bold flex-shrink-0">!</span>{error}
            </div>
          )}
          {warning && (
            <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-4 py-2.5">
              <span className="font-bold flex-shrink-0">!</span>{warning}
            </div>
          )}

          <div className="border-t border-slate-100 pt-4 space-y-3">
            <div className="flex items-center gap-2">
              <StepCircle num={3} />
              <p className="text-sm font-medium text-slate-700">照合を実行する</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => { if (leftText.trim() || rightText.trim()) runCompare(leftText, rightText); }}
                className="h-10 px-5 sm:px-6 text-sm font-semibold bg-slate-900 text-white rounded-lg hover:bg-slate-700 transition-colors"
              >
                照合する →
              </button>
              <button
                onClick={() => { setLeftText(DEMO_LEFT); setRightText(DEMO_RIGHT); runCompare(DEMO_LEFT, DEMO_RIGHT); }}
                className="h-10 px-3 sm:px-4 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
              >
                サンプルで試す
              </button>
              <button
                onClick={handleClear}
                className="h-10 px-3 sm:px-4 text-sm text-slate-500 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition-colors"
              >
                クリア
              </button>

              {stats && (
                <div className="ml-auto flex items-center gap-2 flex-wrap justify-end">
                  {stats.ng === 0 ? (
                    <span className="text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1.5">
                      ✓ すべて一致
                    </span>
                  ) : (
                    <>
                      <span className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-2.5 py-1">
                        一致 {stats.ok} 行
                      </span>
                      <span className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-md px-2.5 py-1">
                        差分 {stats.ng} 行
                      </span>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── 結果ツールバー ── */}
        {results && (
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-xs text-slate-500 font-medium">表示：</p>
            <button
              onClick={() => setDiffOnly(false)}
              className={`h-8 px-3 text-xs rounded-lg border transition-colors ${
                !diffOnly ? "bg-slate-900 text-white border-slate-900" : "text-slate-600 border-slate-200 hover:bg-slate-50"
              }`}
            >
              すべての行
            </button>
            <button
              onClick={() => setDiffOnly(true)}
              className={`h-8 px-3 text-xs rounded-lg border transition-colors ${
                diffOnly ? "bg-rose-600 text-white border-rose-600" : "text-slate-600 border-slate-200 hover:bg-slate-50"
              }`}
            >
              差分のみ{stats && stats.ng > 0 ? ` (${stats.ng})` : ""}
            </button>
            <button
              onClick={() => exportCSV(results)}
              className="h-8 px-3 text-xs text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors ml-auto"
            >
              ↓ CSVで書き出す
            </button>
          </div>
        )}

        {/* ── 結果テーブル ── */}
        {results && (
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="px-4 sm:px-5 py-3 bg-slate-50 border-b border-slate-100 flex items-center gap-4 flex-wrap">
              <span className="flex items-center gap-1.5 text-xs text-slate-600">
                <span className="text-emerald-500 font-bold">✓</span> 一致（問題なし）
              </span>
              <span className="flex items-center gap-1.5 text-xs text-slate-600">
                <span className="text-rose-500 font-bold">✗</span> 差分あり（要確認）
              </span>
              <span className="text-xs text-slate-500 ml-auto hidden sm:inline">
                行番号 · 比較元 · 比較先
              </span>
            </div>

            <div className="grid grid-cols-[44px_minmax(0,1fr)_minmax(0,1fr)] px-4 sm:px-5 py-2 border-b border-slate-100 text-[11px] font-medium text-slate-500 uppercase tracking-wider gap-2 sm:gap-3">
              <div>行</div>
              <div>比較元</div>
              <div>比較先</div>
            </div>

            {displayed.length === 0 ? (
              <div className="py-10 text-center">
                <p className="text-sm text-slate-500">差分は見つかりませんでした</p>
                <p className="text-xs text-slate-400 mt-1">すべての行で一致しています</p>
              </div>
            ) : (
              displayed.map((row) => (
                <div
                  key={row.n}
                  className={`border-b border-slate-100 last:border-0 ${
                    row.ok ? "hover:bg-slate-50/50" : "bg-rose-50/40"
                  }`}
                >
                  <div className="grid grid-cols-[44px_minmax(0,1fr)_minmax(0,1fr)] px-4 sm:px-5 py-3 gap-2 sm:gap-3 items-start">
                    <div className="flex items-center gap-1 pt-0.5">
                      <span className={`text-sm font-bold ${row.ok ? "text-emerald-500" : "text-rose-500"}`}>
                        {row.ok ? "✓" : "✗"}
                      </span>
                      <span className="text-[11px] font-mono text-slate-500">{row.n}</span>
                    </div>
                    <p className={`text-xs sm:text-sm font-mono leading-relaxed break-all ${row.ok ? "text-slate-700" : "text-rose-700"}`}>
                      {row.l || <span className="text-slate-400 italic text-xs">空行</span>}
                    </p>
                    <p className={`text-xs sm:text-sm font-mono leading-relaxed break-all ${row.ok ? "text-slate-700" : "text-rose-700"}`}>
                      {row.r || <span className="text-slate-400 italic text-xs">空行</span>}
                    </p>
                  </div>

                  {!row.ok && (
                    <div className="pl-12 sm:pl-14 pr-4 sm:pr-5 pb-3 space-y-1.5">
                      <p className="text-xs text-rose-600 font-medium">
                        {row.diffs.length} 箇所の違いがあります
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {row.diffs.slice(0, 8).map((p) => (
                          <span
                            key={p}
                            className="inline-flex items-center gap-1 text-[11px] font-mono bg-white border border-rose-100 rounded-md px-1.5 py-0.5"
                          >
                            <span className="text-slate-500">{p + 1}文字目</span>
                            <span className="text-rose-500 font-semibold">「{row.nl[p] ?? "なし"}」</span>
                            <span className="text-slate-400">→</span>
                            <span className="text-emerald-600 font-semibold">「{row.nr[p] ?? "なし"}」</span>
                          </span>
                        ))}
                        {row.diffs.length > 8 && (
                          <span className="text-[11px] text-slate-500 self-center">
                            他 {row.diffs.length - 8} 箇所
                          </span>
                        )}
                      </div>
                      {/* 内部キーなしで表示 */}
                      <p className="text-[11px] font-mono text-slate-500 leading-relaxed">
                        表記ゆれ除去後：
                        <span className="text-sky-600 ml-1 bg-sky-50 px-1 rounded">{row.nld || "（空）"}</span>
                        <span className="mx-1 text-slate-400">→</span>
                        <span className="text-emerald-600 bg-emerald-50 px-1 rounded">{row.nrd || "（空）"}</span>
                      </p>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* フッター：text-slate-500 に変更して視認性アップ */}
        <p className="text-center text-xs text-slate-500 pb-4">
          入力したデータは外部に送信されません · すべてブラウザ内で処理されます
        </p>
      </main>
    </div>
  );
}