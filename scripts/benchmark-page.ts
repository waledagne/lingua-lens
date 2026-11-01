import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { prepareBrowser } from './browser-runtime.ts';

// Production DOM/detection/translation classes with controlled model latency.
// Reports scheduling and cache overhead, not real native-model throughput.
const label = process.argv.find(value => value.startsWith('--label='))?.slice(8) ?? 'current';
if (!/^[a-z0-9-]+$/u.test(label)) throw new Error('Use a simple --label=name.');
const bundle = await build({ stdin: { resolveDir: path.resolve('.'), contents: `
  import { DomTranslator } from './src/dom-translator';
  import { SourceDetector } from './src/source-detector';
  import { PassageEngine } from './src/passage-engine';
  import { TranslationEngine } from './src/translation-engine';
  import { chunks } from './src/segment';
  globalThis.runBenchmark = async (latency) => {
    let translations=0, detections=0;
    const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const engine=new TranslationEngine(()=>({availability:async()=>'available',create:async()=>({translate:async text=>{translations++;await pause(latency);return 'EN:'+text},destroy(){}})}),async(texts,source)=>texts.map(text=>chunks(text,1800,source)));
    const detector=new SourceDetector(()=>({availability:async()=>'available',create:async()=>({detect:async()=>{detections++;await pause(4);return [{detectedLanguage:'pl',confidence:0.99}]},destroy(){}})}));
    const passages=new PassageEngine(context=>detector.detect(context),(texts,pair)=>engine.translate(texts,pair));
    const controller=new DomTranslator(document,(texts,contexts)=>passages.run(texts,contexts,'en',[]));
    controller.setAutomaticDetection(true);
    const all=[...document.querySelectorAll('[data-item]')], visible=[...document.querySelectorAll('#visible [data-item]')];
    const measurements=[];
    for(const pass of ['cold','warm']){
      const beforeTranslations=translations,beforeDetections=detections,started=performance.now();
      let firstVisibleMs=null,visibleReadyMs=null;
      const measure=()=>{
        const complete=visible.filter(element=>element.textContent.startsWith('EN:')).length;
        if(complete&&firstVisibleMs===null)firstVisibleMs=performance.now()-started;
        if(complete===visible.length&&visibleReadyMs===null)visibleReadyMs=performance.now()-started;
      };
      const observer=new MutationObserver(measure);observer.observe(document.body,{subtree:true,characterData:true,childList:true});
      controller.start();
      try{
        while(all.some(element=>!element.textContent.startsWith('EN:'))){
          if(performance.now()-started>60000)throw new Error('Benchmark did not finish: '+JSON.stringify(controller.status()));
          await pause(10);
        }
        measure();measurements.push({pass,items:all.length,firstVisibleMs,visibleReadyMs,totalMs:performance.now()-started,translations:translations-beforeTranslations,detections:detections-beforeDetections});
      }finally{observer.disconnect();controller.stop()}
    }
    return measurements;
  };
` }, bundle: true, write: false, format: 'iife', target: 'chrome138' });
const browser = await chromium.launch({ executablePath: await prepareBrowser(), headless: true });
const results: unknown[] = [];
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  for (const latency of [8, 40]) {
    await page.setContent('<!doctype html><html lang="pl"><head><style>body{margin:0}p{margin:8px}#backlog{position:absolute;top:3000px}#visible{position:absolute;top:0}</style></head><body><div hidden id="hidden"></div><div id="backlog"></div><main id="visible"></main></body></html>');
    await page.evaluate(() => {
      for (const [root, count] of [['hidden', 40], ['backlog', 140], ['visible', 12]] as const) for (let i = 0; i < count; i++) {
        const p = document.createElement('p'); p.dataset.item = ''; p.textContent = 'Informacje o produkcie oraz sposobie dostawy: ' + root + ' numer ' + i;
        document.getElementById(root)!.append(p);
      }
    });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const measurements = await page.evaluate(async latency => (globalThis as typeof globalThis & { runBenchmark(latency: number): Promise<unknown> }).runBenchmark(latency), latency);
    results.push({ nativeLatencyMs: latency, measurements });
  }
  await mkdir('work', { recursive: true });
  const report = { browser: browser.version(), label, modelMode: 'simulated latency; production pipeline classes', results };
  await writeFile('work/page-benchmark-' + label + '.json', JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
