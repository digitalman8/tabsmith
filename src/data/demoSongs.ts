export interface DemoSongDefinition {
  id: string;
  title: string;
  artist: string;
  subtitle: string;
  difficulty: 'Iniciante' | 'Intermediário' | 'Avançado';
  bpm: number;
  tuningLabel: string;
  alphaTex: string;
}

export const DEMO_SONGS: DemoSongDefinition[] = [
  {
    id: 'demo-neon-riff',
    title: 'Neon Riff',
    artist: 'FretFlow Originals',
    subtitle: 'Rock clássico com Palm Mute, Power Chords, Slides e Corda Solta',
    difficulty: 'Iniciante',
    bpm: 118,
    tuningLabel: 'E Standard',
    alphaTex: `\\title "Neon Riff"
\\artist "FretFlow Originals"
\\tempo 118
\\track "Guitarra Rock"
\\instrument overdrivenguitar
\\section "Intro"
(0.6 2.5).4 {ch "E5"} 0.6{pm}.8 0.6{pm}.8 0.6{pm}.8 0.6{pm}.8 (3.6 5.5).4 {ch "G5"} |
(5.6 7.5).4 {ch "A5"} 0.6{pm}.8 0.6{pm}.8 3.6.8 5.6.8 7.5{sl}.4 |
(0.6 2.5).4 {ch "E5"} 0.6{pm}.8 0.6{pm}.8 0.6{pm}.8 0.6{pm}.8 (3.6 5.5).4 {ch "G5"} |
(5.6 7.5).4 {ch "A5"} (3.6 5.5).4 {ch "G5"} (0.6 2.5).2 {ch "E5"} |
\\section "Riff Principal"
0.6{pm}.8 0.6{pm}.8 5.5{h}.8 7.5.8 0.6{pm}.8 0.6{pm}.8 7.5{sl}.8 9.5.8 |
0.6{pm}.8 0.6{pm}.8 5.5{h}.8 7.5.8 8.5.4 7.5{v}.4 |
0.6{pm}.8 0.6{pm}.8 5.5{h}.8 7.5.8 0.6{pm}.8 0.6{pm}.8 9.5{sl}.8 10.5.8 |
7.5.8 5.5.8 7.6.8 5.6.8 3.6.4 0.6.4 |
\\section "Refrão"
(0.6 2.5 2.4).4 {ch "E5"} (0.6 2.5 2.4).4 {ch "E5"} (3.5 5.4 5.3).4 {ch "C5"} (3.5 5.4 5.3).4 {ch "C5"} |
(3.6 5.5 5.4).4 {ch "G5"} (3.6 5.5 5.4).4 {ch "G5"} (5.5 7.4 7.3).4 {ch "D5"} (5.5 7.4 7.3).4 {ch "D5"} |
(0.6 2.5 2.4).4 {ch "E5"} (0.6 2.5 2.4).4 {ch "E5"} (3.5 5.4 5.3).4 {ch "C5"} (3.5 5.4 5.3).4 {ch "C5"} |
(5.6 7.5 7.4).2 {ch "A5"} (7.5 9.4 9.3).2 {ch "B5"} |
\\track "Baixo"
\\instrument electricbassfinger
\\tuning (G2 D2 A1 E1)
0.4.4 0.4.8 0.4.8 0.4.8 0.4.8 3.4.4 |
5.4.4 0.4.8 0.4.8 3.4.8 5.4.8 7.3.4 |
0.4.4 0.4.8 0.4.8 0.4.8 0.4.8 3.4.4 |
5.4.4 3.4.4 0.4.2 |
0.4.8 0.4.8 5.3.8 7.3.8 0.4.8 0.4.8 7.3.8 9.3.8 |
0.4.8 0.4.8 5.3.8 7.3.8 8.3.4 7.3.4 |
0.4.8 0.4.8 5.3.8 7.3.8 0.4.8 0.4.8 9.3.8 10.3.8 |
7.3.8 5.3.8 7.4.8 5.4.8 3.4.4 0.4.4 |
0.4.4 0.4.4 3.3.4 3.3.4 |
3.4.4 3.4.4 5.3.4 5.3.4 |
0.4.4 0.4.4 3.3.4 3.3.4 |
5.4.2 7.4.2 |
\\track "Bateria"
\\instrument percussion
\\articulation defaults
("Kick (hit)" "Crash high (hit)").4 "Hi-Hat (closed)".4 ("Snare (hit)" "Hi-Hat (closed)").4 "Hi-Hat (closed)".4 |
("Kick (hit)" "Hi-Hat (closed)").4 "Hi-Hat (closed)".4 ("Snare (hit)" "Hi-Hat (closed)").4 ("Kick (hit)" "Hi-Hat (closed)").4 |
("Kick (hit)" "Hi-Hat (closed)").4 "Hi-Hat (closed)".4 ("Snare (hit)" "Hi-Hat (closed)").4 "Hi-Hat (closed)".4 |
("Kick (hit)" "Hi-Hat (closed)").4 ("Snare (hit)" "Hi-Hat (closed)").4 ("Kick (hit)" "Crash high (hit)").2 |
("Kick (hit)" "Hi-Hat (closed)").4 "Hi-Hat (closed)".8 "Kick (hit)".8 ("Snare (hit)" "Hi-Hat (closed)").4 "Hi-Hat (closed)".4 |
("Kick (hit)" "Hi-Hat (closed)").4 "Hi-Hat (closed)".8 "Kick (hit)".8 ("Snare (hit)" "Hi-Hat (closed)").4 "Hi-Hat (closed)".4 |
("Kick (hit)" "Hi-Hat (closed)").4 "Hi-Hat (closed)".8 "Kick (hit)".8 ("Snare (hit)" "Hi-Hat (closed)").4 "Hi-Hat (closed)".4 |
("Kick (hit)" "Hi-Hat (closed)").4 "Hi-Hat (closed)".4 ("Snare (hit)" "Hi-Hat (closed)").4 "Snare (hit)".8 "Snare (hit)".8 |
("Kick (hit)" "Crash high (hit)").4 "Hi-Hat (open)".4 ("Snare (hit)" "Hi-Hat (open)").4 ("Kick (hit)" "Hi-Hat (open)").4 |
("Kick (hit)" "Hi-Hat (open)").4 "Hi-Hat (open)".4 ("Snare (hit)" "Hi-Hat (open)").4 ("Kick (hit)" "Hi-Hat (open)").4 |
("Kick (hit)" "Hi-Hat (open)").4 "Hi-Hat (open)".4 ("Snare (hit)" "Hi-Hat (open)").4 ("Kick (hit)" "Hi-Hat (open)").4 |
("Kick (hit)" "Hi-Hat (open)").4 ("Snare (hit)" "Hi-Hat (open)").4 ("Kick (hit)" "Crash high (hit)").2 |`,
  },
  {
    id: 'demo-midnight-blues',
    title: 'Midnight Blues',
    artist: 'FretFlow Originals',
    subtitle: 'Solo em Lá Menor Pentatônica com Bends, Vibrato, Hammer-ons e Mudança de Região',
    difficulty: 'Intermediário',
    bpm: 92,
    tuningLabel: 'E Standard',
    alphaTex: `\\title "Midnight Blues"
\\artist "FretFlow Originals"
\\tempo 92
\\track "Guitarra Solo"
\\instrument electricguitarclean
\\section "Tema (Casa 5)"
5.6.8 8.6.8 5.5.8 7.5.8 5.4.4 7.4{v}.4 |
7.3{b (0 0 2 4)}.4 5.2.8 8.2.8 5.1.4 8.1{h}.8 5.1.8 |
7.3.8 5.3.8 7.4.8 5.4.8 7.5{sl}.8 5.5.8 3.5.4 |
5.5.4 7.5{v}.4 (5.6 5.4 5.3 5.2).2 {ch "Am7"} |
\\section "Licks Agudos (Casas 7–10)"
7.3{sl}.8 9.3.8 8.2.8 10.2.8 10.2{b (0 0 2 4)}.4 8.2.4 |
8.1{h}.8 10.1.8 10.1{b (0 0 2 4)}.4 10.1{v}.4 8.1.4 |
10.2{h}.8 8.2.8 9.3.8 7.3.8 9.3{sl}.8 11.3.8 10.2.4 |
12.1{v}.2 (7.4 9.3 8.2 7.1).2 {ch "D9"} |
\\section "Turnaround"
8.2.8 7.2.8 5.2.8 7.3.8 5.3.4 7.4{v}.4 |
7.5.8 6.5.8 5.5.8 3.5.8 (5.6 7.5 5.4 5.3 5.2 5.1).2 {ch "Am7"} |
\\track "Baixo"
\\instrument electricbassfinger
\\tuning (G2 D2 A1 E1)
5.4.4 5.4.4 8.4.4 7.3.4 |
5.3.4 7.3.4 5.4.4 3.4.4 |
5.4.4 5.4.4 7.4.4 8.4.4 |
5.4.2 5.4.2 |
5.3.4 5.3.4 4.3.4 3.3.4 |
2.3.4 5.4.4 7.4.4 5.4.4 |
5.3.4 7.3.4 5.3.4 4.3.4 |
5.3.2 5.3.2 |
5.4.4 3.4.4 2.4.4 0.4.4 |
5.4.2 5.4.2 |
\\track "Bateria"
\\instrument percussion
\\articulation defaults
("Kick (hit)" "Ride (middle)").4 "Ride (middle)".4 ("Snare (hit)" "Ride (middle)").4 "Ride (middle)".4 |
("Kick (hit)" "Ride (middle)").4 "Ride (middle)".4 ("Snare (hit)" "Ride (middle)").4 "Ride (middle)".4 |
("Kick (hit)" "Ride (middle)").4 "Ride (middle)".4 ("Snare (hit)" "Ride (middle)").4 "Ride (middle)".4 |
("Kick (hit)" "Ride (middle)").4 "Ride (middle)".4 ("Snare (hit)" "Ride (middle)").4 "Ride (middle)".4 |
("Kick (hit)" "Ride (middle)").4 "Ride (middle)".4 ("Snare (hit)" "Ride (middle)").4 "Ride (middle)".4 |
("Kick (hit)" "Ride (middle)").4 "Ride (middle)".4 ("Snare (hit)" "Ride (middle)").4 "Ride (middle)".4 |
("Kick (hit)" "Ride (middle)").4 "Ride (middle)".4 ("Snare (hit)" "Ride (middle)").4 "Ride (middle)".4 |
("Kick (hit)" "Ride (middle)").4 "Ride (middle)".4 ("Snare (hit)" "Ride (middle)").4 "Ride (middle)".4 |
("Kick (hit)" "Ride (middle)").4 "Ride (middle)".4 ("Snare (hit)" "Ride (middle)").4 "Ride (middle)".4 |
("Kick (hit)" "Crash high (hit)").4 "Ride (middle)".4 ("Snare (hit)" "Ride (middle)").4 ("Kick (hit)" "Crash high (hit)").4 |`,
  },
  {
    id: 'demo-crystal-arpeggios',
    title: 'Crystal Arpeggios',
    artist: 'FretFlow Originals',
    subtitle: 'Arpejos Limpos, Painéis de Acordes (Em, C, G, D) e Harmônicos Naturais',
    difficulty: 'Iniciante',
    bpm: 100,
    tuningLabel: 'E Standard',
    alphaTex: `\\title "Crystal Arpeggios"
\\artist "FretFlow Originals"
\\tempo 100
\\track "Violão / Clean"
\\instrument acousticguitarsteel
\\section "Arpejos Em - C"
0.6.8 2.5.8 2.4.8 0.3.8 0.2.8 0.1.8 0.2.8 0.3.8 |
3.5.8 2.4.8 0.3.8 1.2.8 0.1.8 1.2.8 0.3.8 2.4.8 |
\\section "Arpejos G - D"
3.6.8 2.5.8 0.4.8 0.3.8 3.2.8 3.1.8 3.2.8 0.3.8 |
0.4.8 2.3.8 3.2.8 2.1.8 12.1{nh}.4 12.2{nh}.4 |
\\section "Acordes Base"
(0.6 2.5 2.4 0.3 0.2 0.1).4 {ch "Em"} (0.6 2.5 2.4 0.3 0.2 0.1).4 {ch "Em"} (3.5 2.4 0.3 1.2 0.1).4 {ch "C"} (3.5 2.4 0.3 1.2 0.1).4 {ch "C"} |
(3.6 2.5 0.4 0.3 3.2 3.1).4 {ch "G"} (3.6 2.5 0.4 0.3 3.2 3.1).4 {ch "G"} (0.4 2.3 3.2 2.1).4 {ch "D"} (0.4 2.3 3.2 2.1).4 {ch "D"} |
(0.6 2.5 2.4 0.3 0.2 0.1).1 {ch "Em"} |
\\track "Baixo"
\\instrument electricbassfinger
\\tuning (G2 D2 A1 E1)
0.4.2 0.4.2 |
3.3.2 3.3.2 |
3.4.2 3.4.2 |
0.3.2 0.3.2 |
0.4.2 3.3.2 |
3.4.2 0.3.2 |
0.4.1 |
\\track "Bateria"
\\instrument percussion
\\articulation defaults
("Kick (hit)" "Hi-Hat (closed)").4 "Hi-Hat (closed)".4 ("Snare (hit)" "Hi-Hat (closed)").4 "Hi-Hat (closed)".4 |
("Kick (hit)" "Hi-Hat (closed)").4 "Hi-Hat (closed)".4 ("Snare (hit)" "Hi-Hat (closed)").4 "Hi-Hat (closed)".4 |
("Kick (hit)" "Hi-Hat (closed)").4 "Hi-Hat (closed)".4 ("Snare (hit)" "Hi-Hat (closed)").4 "Hi-Hat (closed)".4 |
("Kick (hit)" "Hi-Hat (closed)").4 "Hi-Hat (closed)".4 ("Snare (hit)" "Hi-Hat (closed)").4 "Hi-Hat (closed)".4 |
("Kick (hit)" "Crash high (hit)").4 "Hi-Hat (closed)".4 ("Snare (hit)" "Hi-Hat (closed)").4 "Hi-Hat (closed)".4 |
("Kick (hit)" "Hi-Hat (closed)").4 "Hi-Hat (closed)".4 ("Snare (hit)" "Hi-Hat (closed)").4 "Hi-Hat (closed)".4 |
("Kick (hit)" "Crash high (hit)").1 |`,
  },
];
