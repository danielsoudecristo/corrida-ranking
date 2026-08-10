// ranking.js — CORRIDA-RANKING
//
// Conecta direto no Supabase (só leitura — chave pública, protegida pelas regras RLS que
// não deixam ninguém escrever) e monta os 3 rankings. Não passa pelo PC/server.js em
// nenhum momento — por isso continua funcionando com o PC desligado.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ============================================================================
// PREENCHA AQUI — são valores PÚBLICOS (a URL do projeto e a chave "anon/public"),
// seguros de expor no site: quem protege os dados é a regra RLS lá no Supabase (só
// leitura), não o segredo dessa chave. NUNCA cole aqui a chave "service_role" — essa
// fica só no servidor, dentro do arquivo .env, que nunca vai pro site público.
// Onde achar: Supabase → seu projeto → ⚙️ Project Settings → API.
// ============================================================================
const SUPABASE_URL = 'https://yciozcjbqsqyljapvfsl.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_Xo3Le8kauzM7VKBT2PVGRQ_KK2HIoc6';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// mesma tabela de ligas do ligas.js do jogo (Bronze 50 até Leoncs 100.000) — se um dia
// mudar os valores lá no jogo, troque aqui também pra manter os dois batendo
const LIGAS = [
  { nome: 'Bronze', trofeus: 50, icone: 'Bronze.png' },
  { nome: 'Prata', trofeus: 1000, icone: 'Prata.png' },
  { nome: 'Ouro', trofeus: 3000, icone: 'Ouro.png' },
  { nome: 'Diamante', trofeus: 8000, icone: 'Diamante.png' },
  { nome: 'Mestre', trofeus: 18000, icone: 'Mestre.png' },
  { nome: 'Campeão', trofeus: 35000, icone: 'Campeão.png' },
  { nome: 'Lendas', trofeus: 60000, icone: 'Lendas.png' },
  { nome: 'Leoncs', trofeus: 100000, icone: 'Leoncs.png' },
];
function getLigaPorTrofeus(trofeus) {
  if (trofeus < LIGAS[0].trofeus) return null;
  let atual = LIGAS[0];
  for (const l of LIGAS) { if (trofeus >= l.trofeus) atual = l; else break; }
  return atual;
}

// mesma função de nome que o jogo já usa — só a primeira palavra do nome, sem acento/
// símbolo, pra busca e exibição ficarem consistentes com o que aparece dentro do jogo.
// Se der um pedaço curto demais (tipo "E", "AR" — não identifica ninguém de verdade,
// geralmente por causa de letras "decoradas" unicode que não contam como letra normal),
// cai num plano B: pega tudo até o primeiro ESPAÇO de verdade, sem cortar em pontuação.
function primeiraPalavraDoNome(usuario) {
  const bruto = (usuario || '').trim();
  const encontrado = bruto.match(/[\p{L}\p{N}]+/u);
  let primeira = encontrado ? encontrado[0] : bruto;

  if (primeira.length <= 3 && bruto.length > primeira.length) {
    const ateOEspaco = bruto.split(/\s+/)[0];
    const semSimbolosNasPontas = ateOEspaco.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    if (semSimbolosNasPontas.length > primeira.length) primeira = semSimbolosNasPontas;
  }
  return primeira ? primeira.charAt(0).toUpperCase() + primeira.slice(1) : primeira;
}

// pega os nomes de exibição de uma LISTA inteira de uma vez e DESAMBIGUA quem bate no
// mesmo primeiro nome — ex: "Daniel Barros" e "Daniel Fernandes" os dois virariam só
// "Daniel"; aqui, quando isso acontece, cada um ganha a inicial da segunda palavra do nome
// de verdade: "Daniel B." e "Daniel F." — só quem realmente colide ganha esse sufixo
function nomesParaExibirComDesambiguacao(listaDeUsuarios) {
  const base = listaDeUsuarios.map(primeiraPalavraDoNome);
  const contagem = {};
  base.forEach((n) => { const chave = n.toLowerCase(); contagem[chave] = (contagem[chave] || 0) + 1; });

  return listaDeUsuarios.map((usuarioReal, i) => {
    const nomeBase = base[i];
    if (contagem[nomeBase.toLowerCase()] <= 1) return nomeBase;
    const palavras = (usuarioReal || '').trim().split(/\s+/).filter(Boolean);
    if (palavras.length > 1) {
      const segundaLetra = (palavras[1].match(/[\p{L}\p{N}]/u) || [])[0];
      if (segundaLetra) return `${nomeBase} ${segundaLetra.toUpperCase()}.`;
    }
    return nomeBase;
  });
}
function normalizarBusca(txt) {
  return (txt || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
function iniciaisDe(usuario) {
  const p = primeiraPalavraDoNome(usuario);
  return (p[0] || '?').toUpperCase();
}

// guarda os dados já carregados de cada ranking, pra busca não precisar ir no banco de novo
const cache = { diario: [], semanal: [], ligas: [] };

// ---------------------------------------------------------------------------
// carregamento dos 3 rankings
// ---------------------------------------------------------------------------
// quantas linhas buscar de cada ranking — bem mais que o suficiente pra não cortar
// ninguém, mas explícito (o Supabase, por padrão, corta em 1000 linhas SEM avisar se a
// consulta não disser um limite — isso podia fazer gente "sumir" do ranking sem erro nenhum)
const LIMITE_LINHAS = 5000;

async function carregarRanking(chave) {
  const container = document.getElementById(`lista-${chave}`);
  try {
    const nomeView = chave === 'diario' ? 'ranking_diario' : chave === 'semanal' ? 'ranking_semanal' : 'ranking_ligas';
    // campo usado pra ordenar CADA ranking — ligas usa o troféu permanente da liga; diário
    // e semanal usam "pontos" (que já é o troféu do período certo, calculado pela view)
    const campoOrdenacao = chave === 'ligas' ? 'trofeus_total' : 'pontos';
    // pede a ordenação AQUI, na consulta — não basta a VIEW já ter "order by" internamente:
    // sem pedir explicitamente na consulta, o Postgres não garante manter essa ordem
    const { data, error } = await supabase
      .from(nomeView)
      .select('*')
      .order(campoOrdenacao, { ascending: false })
      .order('usuario', { ascending: true }) // desempate fixo (alfabético) entre quem tem a mesma pontuação — sem isso, o Postgres pode devolver os empatados em ordem diferente a cada consulta
      .limit(LIMITE_LINHAS);
    if (error) throw error;
    cache[chave] = data || [];
    renderizarLista(chave);
    return true;
  } catch (e) {
    console.error(`Erro ao carregar ranking "${chave}":`, e.message);
    container.innerHTML = `<p class="estado-info erro">⚠️ Não consegui carregar o ranking agora.<br>Tenta recarregar a página em instantes.</p>`;
    return false;
  }
}

function renderizarLista(chave) {
  const container = document.getElementById(`lista-${chave}`);
  const linhas = cache[chave];
  if (!linhas.length) {
    container.innerHTML = '<p class="estado-info">Ainda não tem ninguém nesse ranking.</p>';
    return;
  }
  const campoValor = chave === 'ligas' ? 'trofeus_total' : 'pontos';
  const labelValor = 'TROFÉUS';
  const nomes = nomesParaExibirComDesambiguacao(linhas.map((j) => j.usuario));
  container.innerHTML = linhas.map((j, i) => cardHtml(i + 1, j, campoValor, labelValor, nomes[i])).join('');
  // depois de trocar o HTML, se já tinha uma busca ativa nesse ranking, reaplica o destaque
  reaplicarDestaqueSeTiver(chave);
}

function cardHtml(posicao, j, campoValor, labelValor, nomeExibido) {
  const liga = getLigaPorTrofeus(j.trofeus_total);
  const classeMedalha = posicao === 1 ? 'ouro' : posicao === 2 ? 'prata' : posicao === 3 ? 'bronze' : '';
  const medalha = posicao === 1 ? '🥇' : posicao === 2 ? '🥈' : posicao === 3 ? '🥉' : '';
  const iniciais = iniciaisDe(j.usuario);
  const valor = (Number(j[campoValor]) || 0).toLocaleString('pt-BR');
  const ligaHtml = liga
    ? `<div class="card-liga"><img src="liga/${liga.icone}" alt="${liga.nome}" onerror="this.style.display='none'"> ${liga.nome}</div>`
    : '';
  const fotoHtml = j.foto
    ? `<img src="${j.foto}" alt="" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
       <span class="card-avatar-fallback" style="display:none;">${iniciais}</span>`
    : `<span class="card-avatar-fallback" style="display:flex;">${iniciais}</span>`;
  return `
    <div class="card-jogador ${classeMedalha}" data-usuario="${(j.usuario || '').toLowerCase()}">
      <div class="card-medalha">${medalha}</div>
      <div class="card-pos">${posicao}º</div>
      <div class="card-avatar">${fotoHtml}</div>
      <div class="card-info">
        <div class="card-nome">${nomeExibido}</div>
        ${ligaHtml}
      </div>
      <div class="card-valor">
        <div class="card-valor-num">${valor}</div>
        <div class="card-valor-label">${labelValor}</div>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// contagem de tempo até o próximo reset (calculada aqui no navegador, com a hora
// local da própria pessoa — não depende do servidor nem do PC estar ligado)
// ---------------------------------------------------------------------------
function atualizarContagens() {
  const agora = new Date();

  const meiaNoite = new Date(agora);
  meiaNoite.setDate(agora.getDate() + 1);
  meiaNoite.setHours(0, 0, 0, 0);
  const msAteMeiaNoite = meiaNoite - agora;
  const hDia = Math.floor(msAteMeiaNoite / 3600000);
  const mDia = Math.floor((msAteMeiaNoite % 3600000) / 60000);
  document.getElementById('info-periodo-diario').textContent = `⏳ Restam ${hDia}h ${mDia}min`;

  const diaSemana = agora.getDay(); // 0=domingo
  const diasAteSegunda = diaSemana === 1 ? 7 : ((8 - diaSemana) % 7) || 7;
  const proximaSegunda = new Date(agora);
  proximaSegunda.setDate(agora.getDate() + diasAteSegunda);
  proximaSegunda.setHours(0, 0, 0, 0);
  const msAteSegunda = proximaSegunda - agora;
  const dSemana = Math.floor(msAteSegunda / 86400000);
  const hSemana = Math.floor((msAteSegunda % 86400000) / 3600000);
  document.getElementById('info-periodo-semanal').textContent = `⏳ Restam ${dSemana}d ${hSemana}h`;
}

// ---------------------------------------------------------------------------
// busca + localização automática — cada ranking tem a SUA PRÓPRIA busca, e ela só
// destaca/rola até o jogador, nunca muda a ordem real da lista
// ---------------------------------------------------------------------------
const buscaAtiva = {}; // chave -> termo digitado (guardado pra reaplicar o destaque quando o ranking recarrega)

function configurarBusca(chave) {
  const input = document.getElementById(`busca-${chave}`);
  const wrap = input.closest('.busca-wrap');
  const botaoLimpar = document.getElementById(`busca-${chave}-limpar`);
  const resultado = document.getElementById(`busca-${chave}-resultado`);

  function limparDestaques() {
    document.querySelectorAll(`#lista-${chave} .card-jogador`).forEach((el) => el.classList.remove('destaque-busca'));
  }

  function executarBusca() {
    const termo = input.value.trim();
    wrap.classList.toggle('tem-texto', termo.length > 0);
    limparDestaques();
    if (!termo) {
      resultado.textContent = '';
      resultado.className = 'busca-resultado';
      buscaAtiva[chave] = '';
      return;
    }
    buscaAtiva[chave] = termo;
    const alvo = normalizarBusca(termo);
    const lista = cache[chave];
    const idx = lista.findIndex((j) => normalizarBusca(j.usuario).includes(alvo));
    if (idx === -1) {
      resultado.textContent = `❌ Ninguém encontrado com "${termo}" nesse ranking.`;
      resultado.className = 'busca-resultado erro';
      return;
    }
    resultado.textContent = `✅ @${lista[idx].usuario} está em ${idx + 1}º lugar!`;
    resultado.className = 'busca-resultado ok';
    const cards = document.querySelectorAll(`#lista-${chave} .card-jogador`);
    const alvoEl = cards[idx];
    if (alvoEl) {
      alvoEl.classList.add('destaque-busca');
      alvoEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  let timeoutBusca;
  input.addEventListener('input', () => {
    clearTimeout(timeoutBusca);
    timeoutBusca = setTimeout(executarBusca, 250); // pequena pausa pra não buscar a cada letrinha
  });
  botaoLimpar.addEventListener('click', () => { input.value = ''; executarBusca(); input.focus(); });
}

// se o ranking recarregar (ex: trocou de aba e voltou) e já tinha uma busca ativa, reaplica
// o destaque sem precisar a pessoa digitar de novo
function reaplicarDestaqueSeTiver(chave) {
  const termo = buscaAtiva[chave];
  if (!termo) return;
  const alvo = normalizarBusca(termo);
  const idx = cache[chave].findIndex((j) => normalizarBusca(j.usuario).includes(alvo));
  if (idx === -1) return;
  const cards = document.querySelectorAll(`#lista-${chave} .card-jogador`);
  if (cards[idx]) cards[idx].classList.add('destaque-busca');
}

// ---------------------------------------------------------------------------
// troca de abas (Diário / Semanal / Ligas) — a pesquisa de cada uma é independente
// ---------------------------------------------------------------------------
function configurarAbas() {
  document.querySelectorAll('.aba').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.aba').forEach((b) => { b.classList.remove('ativa'); b.setAttribute('aria-selected', 'false'); });
      btn.classList.add('ativa');
      btn.setAttribute('aria-selected', 'true');
      const chave = btn.dataset.aba;
      document.querySelectorAll('.painel-ranking').forEach((p) => p.classList.remove('ativa'));
      document.getElementById(`painel-${chave}`).classList.add('ativa');
    });
  });
}

// ---------------------------------------------------------------------------
// início
// ---------------------------------------------------------------------------
async function iniciar() {
  configurarAbas();
  ['diario', 'semanal', 'ligas'].forEach(configurarBusca);
  atualizarContagens();
  setInterval(atualizarContagens, 30000); // atualiza a contagem regressiva a cada 30s

  const statusEl = document.getElementById('status-conexao');
  const resultados = await Promise.all([
    carregarRanking('diario'),
    carregarRanking('semanal'),
    carregarRanking('ligas'),
  ]);
  statusEl.textContent = resultados.every(Boolean)
    ? '🟢 Dados atualizados'
    : '🔴 Alguns rankings não carregaram — tenta recarregar a página';

  // atualiza os rankings sozinho de tempos em tempos, sem precisar recarregar a página
  // (ex: alguém deixa a aba do celular aberta olhando durante a live)
  setInterval(async () => {
    const abaAtiva = document.querySelector('.painel-ranking.ativa')?.dataset.ranking;
    if (abaAtiva) await carregarRanking(abaAtiva);
  }, 30000);
}

iniciar();
