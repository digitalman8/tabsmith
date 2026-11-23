# FretFlow — Braço 3D de Tablaturas

Webapp de estudo de tablaturas de guitarra e baixo com visualização de braço 3D inspirada no **Rocksmith**, reprodução por sintetizador SoundFont, importação de arquivos **Guitar Pro** e **sincronia automática** com áudio original (MP3/WAV).

## Principais Recursos

- **Braço 3D Rocksmith (Canvas HiDPI 60–120 fps)**
  - 6 cordas coloridas no padrão Rocksmith (E Vermelho, A Amarelo, D Azul, G Laranja, B Verde, e Roxo), com suporte a baixo (4/5 cordas) e guitarras de 7/8 cordas.
  - Câmera dinâmica e faixa ativa azul acompanhando a região da mão no braço.
  - Notação visual de técnicas: *palm mute* (`X`), *hammer-on/pull-off* (`H`/`P`), *slides* inclinados, *bends*, *vibrato*, harmônicos, cordas soltas e painéis de acordes.
  - Botão para **inverter orientação das cordas** (Rocksmith vs. Tablatura clássica) e **Modo Canhoto**.
- **Ferramentas de Aprendizado**
  - Controle de velocidade (`25%` a `150%`) preservando a afinação original.
  - **Loop A–B** por seção ou alças arrastáveis no minimap superior + **Speed Trainer** (acelerador progressivo automático).
  - Antecipação visual da esteira independente do BPM, contagem regressiva (`1` ou `2` compassos), metrônomo e **Mini-Tablatura 2D sincronizada**.
  - Mixer multi-faixa (selecionar instrumento no braço + Volume / Mute / Solo).
- **Importação e Sincronia Automática com Áudio Original**
  - Suporte a **Guitar Pro** (`.gp3`, `.gp4`, `.gp5`, `.gpx`, `.gp` GP7/GP8), **MusicXML** (`.xml`, `.musicxml`, `.mxl`), **AlphaTex** (`.atex`) e **Tablaturas ASCII** (`.txt` ou colar texto).
  - Motor de **Auto-Sincronia (Chroma + Onset + Banded DTW em Web Worker)** 100% local no navegador para alinhar MP3/WAV originais com a tablatura — compensando silêncio inicial, variação de andamento (*tempo drift*) e desvios de afinação (`±2` semitons).
  - Estúdio manual avançado (Waveform interativa com arraste de compassos e Tap Sync ao vivo) + persistência offline em `IndexedDB`.

## Como Rodar Localmente

```bash
npm install
npm run dev
```

## Testes e Build

```bash
npm test
npm run build
```

## Stack

- React 19 + TypeScript + Vite 6 + Tailwind CSS v4
- `@coderline/alphatab` + `@coderline/alphatab-vite`
- HTML5 Canvas 2D HiDPI + Web Audio API + Web Workers + IndexedDB
- Vitest
