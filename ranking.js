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

// mesma tabela de ligas do ligas.js do jogo (Bronze 50 até Leoncs 50.000) — se um dia
// mudar os valores lá no jogo, troque aqui também pra manter os dois batendo
const LIGAS = [
  { nome: 'Bronze', trofeus: 50, icone: 'Bronze.png' },
  { nome: 'Prata', trofeus: 500, icone: 'Prata.png' },
  { nome: 'Ouro', trofeus: 1500, icone: 'Ouro.png' },
  { nome: 'Diamante', trofeus: 4000, icone: 'Diamante.png' },
  { nome: 'Mestre', trofeus: 9000, icone: 'Mestre.png' },
  { nome: 'Campeão', trofeus: 17500, icone: 'Campeão.png' },
  { nome: 'Lendas', trofeus: 30000, icone: 'Lendas.png' },
  { nome: 'Leoncs', trofeus: 50000, icone: 'Leoncs.png' },
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

// mesmo ícone de coroa (SVG) que o jogo usa no lugar da medalha do 1º/2º/3º lugar
const SVG_COROA = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 18h18l-1.4-8.2-4.6 3.4L12 6l-3 7.2-4.6-3.4L3 18z"/></svg>`;

// guarda os dados já carregados de cada ranking, pra busca não precisar ir no banco de novo
const cache = { diario: [], semanal: [], mensal: [], ligas: [], moedas: [] };

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
    const nomeView = chave === 'diario' ? 'ranking_diario' : chave === 'semanal' ? 'ranking_semanal' : chave === 'mensal' ? 'ranking_mensal' : chave === 'moedas' ? 'ranking_moedas' : 'ranking_ligas';
    // campo usado pra ordenar CADA ranking — ligas usa o troféu permanente da liga; diário,
    // semanal e mensal usam "pontos" (que já é o troféu do período certo, calculado pela
    // view); moedas usa "moedas_semana" (nome antigo da coluna, mantido só por compatibilidade
    // — na prática hoje é PERMANENTE, nunca reseta, igual troféu total)
    const campoOrdenacao = chave === 'ligas' ? 'trofeus_total' : chave === 'moedas' ? 'moedas_semana' : 'pontos';
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
  const campoValor = chave === 'ligas' ? 'trofeus_total' : chave === 'moedas' ? 'moedas_semana' : 'pontos';
  const labelValor = chave === 'moedas' ? 'MOEDAS' : 'TROFÉUS';
  const nomes = nomesParaExibirComDesambiguacao(linhas.map((j) => j.usuario));
  container.innerHTML = linhas.map((j, i) => cardHtml(i + 1, j, campoValor, labelValor, nomes[i])).join('');
  // depois de trocar o HTML, se já tinha uma busca ativa nesse ranking, reaplica o destaque
  reaplicarDestaqueSeTiver(chave);
}

function cardHtml(posicao, j, campoValor, labelValor, nomeExibido) {
  const liga = getLigaPorTrofeus(j.trofeus_total);
  const classeMedalha = posicao === 1 ? 'ouro' : posicao === 2 ? 'prata' : posicao === 3 ? 'bronze' : '';
  // coroa no lugar da medalha — o div fica sempre presente (mesmo vazio) pra manter o
  // alinhamento das linhas igual, seja ela top 3 ou não, igual no jogo
  const coroaHtml = `<div class="card-coroa ${classeMedalha}">${classeMedalha ? SVG_COROA : ''}</div>`;
  const iniciais = iniciaisDe(j.usuario);
  const valor = (Number(j[campoValor]) || 0).toLocaleString('pt-BR');
  // emblema grande da liga do lado do avatar, igual no jogo — quem ainda não bateu Bronze
  // (menos de 50 troféus) ganha um círculo preto escrito "sem liga" no lugar do escudo
  const emblemaHtml = liga
    ? `<img src="liga/${liga.icone}" alt="${liga.nome}" onerror="this.style.display='none'">`
    : `<div class="card-sem-liga">sem liga</div>`;
  const ligaNomeHtml = liga ? `<div class="card-liga">${liga.nome}</div>` : '';
  const fotoHtml = j.foto
    ? `<img src="${j.foto}" alt="" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
       <span class="card-avatar-fallback" style="display:none;">${iniciais}</span>`
    : `<span class="card-avatar-fallback" style="display:flex;">${iniciais}</span>`;
  return `
    <div class="card-jogador ${classeMedalha}" data-usuario="${(j.usuario || '').toLowerCase()}">
      ${coroaHtml}
      <div class="card-pos">${posicao}º</div>
      <div class="card-avatar">${fotoHtml}</div>
      <div class="card-emblema">${emblemaHtml}</div>
      <div class="card-info">
        <div class="card-nome">${nomeExibido}</div>
        ${ligaNomeHtml}
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
  const NOMES_MESES_PT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

  const meiaNoite = new Date(agora);
  meiaNoite.setDate(agora.getDate() + 1);
  meiaNoite.setHours(0, 0, 0, 0);
  const msAteMeiaNoite = meiaNoite - agora;
  const hDia = Math.floor(msAteMeiaNoite / 3600000);
  const mDia = Math.floor((msAteMeiaNoite % 3600000) / 60000);
  document.getElementById('info-periodo-diario').textContent = `Dia ${agora.getDate()} · ⏳ Restam ${hDia}h ${mDia}min`;

  const diaSemana = agora.getDay(); // 0=domingo
  const NOMES_DIAS_SEMANA_PT = ['Domingo', 'Segunda-Feira', 'Terça-Feira', 'Quarta-Feira', 'Quinta-Feira', 'Sexta-Feira', 'Sábado'];
  const diasAteSegunda = diaSemana === 1 ? 7 : ((8 - diaSemana) % 7) || 7;
  const proximaSegunda = new Date(agora);
  proximaSegunda.setDate(agora.getDate() + diasAteSegunda);
  proximaSegunda.setHours(0, 0, 0, 0);
  const msAteSegunda = proximaSegunda - agora;
  const dSemana = Math.floor(msAteSegunda / 86400000);
  const hSemana = Math.floor((msAteSegunda % 86400000) / 3600000);
  document.getElementById('info-periodo-semanal').textContent = `${NOMES_DIAS_SEMANA_PT[diaSemana]} · ⏳ Restam ${dSemana}d ${hSemana}h`;
  // moedas é PERMANENTE agora (nunca reseta) — sem contagem regressiva nenhuma, mesmo texto
  // fixo que o Ranking de Melhores Ligas já usa (que também é permanente)
  const elMoedas = document.getElementById('info-periodo-moedas');
  if (elMoedas) elMoedas.textContent = '🏆 Ranking permanente — nunca reseta';

  // mensal reseta no dia 1º do próximo mês, meia-noite — relógio PRÓPRIO, igual o jogo
  const proximoMes = new Date(agora.getFullYear(), agora.getMonth() + 1, 1, 0, 0, 0, 0);
  const msAteProximoMes = proximoMes - agora;
  const dMes = Math.floor(msAteProximoMes / 86400000);
  const hMes = Math.floor((msAteProximoMes % 86400000) / 3600000);
  const elMensal = document.getElementById('info-periodo-mensal');
  if (elMensal) elMensal.textContent = `${NOMES_MESES_PT[agora.getMonth()]} · ⏳ Restam ${dMes}d ${hMes}h`;
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

// ===================================================================
// COMO FUNCIONA — dados dos 13 carros VIP (mesmo texto/regra do jogo,
// CARROS_VIP_PADRAO no server.js) + grid clicável + modal de detalhe.
// Isso aqui é conteúdo ESTÁTICO (não vem do Supabase) — só uma explicação
// bonita pra quem nunca jogou entender rapidinho.
// ===================================================================
const CARROS_VIP_INFO = [
  { nome: 'Street', preco: 1000, imagem: 'Street.png',
    resumo: 'Turbo grátis extra',
    habilidade: '🟢 <strong>Nitro Extra</strong> — sempre que manda um presente de 99 moedas ou mais, ganha alguns segundos de turbo DE GRAÇA, por cima do impulso normal do presente.' },
  { nome: 'Turbo', preco: 2500, imagem: 'Turbo.png',
    resumo: 'Dobra a duração do impulso',
    habilidade: '🟡 <strong>Turbo Prolongado</strong> — o impulso que acabou de ganhar com o presente dura o DOBRO do tempo normal.' },
  { nome: 'Apex', preco: 5000, imagem: 'Apex.png',
    resumo: 'Trava quem tá logo atrás',
    habilidade: '🟢 <strong>Trava a Perseguição</strong> — trava por alguns segundos os 2 carros logo atrás dele na classificação, protegendo a posição atual.' },
  { nome: 'Phantom', preco: 10000, imagem: 'Phantom.png',
    resumo: 'Escudo automático',
    habilidade: '⚪ <strong>Escudo Fantasma</strong> — ganha um escudo de 20 segundos na hora, sem precisar digitar nada no chat.' },
  { nome: 'Vortex', preco: 20000, imagem: 'Vortex.png',
    resumo: 'Desacelera quem tá perto',
    habilidade: '🟣 <strong>Redemoinho</strong> — desacelera pra quase parado todo mundo que estiver fisicamente perto dele na pista.' },
  { nome: 'Hard Core', preco: 40000, imagem: 'Hard Core.png',
    resumo: 'Congela TODOS os outros',
    habilidade: '🔴 <strong>Muro de Gelo</strong> — congela todos os outros carros da pista de uma vez só. O poder mais bruto dos 6 primeiros.' },
  { nome: 'Raptor', preco: 60000, ligaMinima: 'Prata', imagem: 'Raptor.png',
    resumo: 'Reflete qualquer poder',
    habilidade: '🦖 <strong>Reflexo</strong> — por um tempo, qualquer poder usado CONTRA ele (congelar, desacelerar) volta pra quem usou.' },
  { nome: 'Raven', preco: 80000, ligaMinima: 'Ouro', imagem: 'Raven.png',
    resumo: 'Escudo + reflete congelamento',
    habilidade: '🦅 <strong>Contra-Ataque</strong> — ganha escudo E, além disso, qualquer tentativa de CONGELAR ele volta pra quem tentou (que fica congelado no lugar dele).' },
  { nome: 'Fury', preco: 110000, ligaMinima: 'Diamante', imagem: 'Fury.png',
    resumo: 'Copia o último impulso da pista',
    habilidade: '🔥 <strong>Cópia</strong> — copia o último impulso que aconteceu em QUALQUER carro da pista (de qualquer pessoa) e aplica esse mesmo impulso nele.' },
  { nome: 'Venom', preco: 150000, ligaMinima: 'Mestre', imagem: 'Venom.png',
    resumo: 'Joga os 2 da frente pra trás',
    habilidade: '🐍 <strong>Emboscada</strong> — joga os 2 carros logo à frente dele de volta pro começo da volta 1, não importa em que volta eles estivessem, e passa na frente dos dois.' },
  { nome: 'Shadow', preco: 200000, ligaMinima: 'Campeão', imagem: 'Shadow.png',
    resumo: 'Paralisa até ultrapassar',
    habilidade: '🌑 <strong>Eclipse</strong> — paralisa TODOS os outros carros no lugar. Cada um só se solta quando o Shadow realmente ultrapassa ele.' },
  { nome: 'Storm', preco: 260000, ligaMinima: 'Lendas', imagem: 'Storm.png',
    resumo: '+2 voltas na hora',
    habilidade: '⚡ <strong>Tempestade</strong> — avança 2 voltas inteiras na hora. Exige presente de 299 moedas ou mais (o dobro do normal).' },
  { nome: 'Legend', preco: 350000, ligaMinima: 'Leoncs', imagem: 'Legend.png', destaque: true,
    resumo: 'Troca de lugar com o líder',
    habilidade: '🦁 <strong>Lenda</strong> — troca de posição direto com quem está em 1º lugar agora. O carro mais raro e mais forte do jogo.' },
];

function cfCarroCardHtml(carro, indice) {
  const coroa = carro.destaque ? ' <span class="coroa">👑</span>' : '';
  const selo = carro.ligaMinima
    ? `<img class="cf-carro-selo" src="liga/${carro.ligaMinima}.png" alt="${carro.ligaMinima}" onerror="this.style.display='none'">`
    : '';
  return `
    <button type="button" class="cf-carro-card ${carro.destaque ? 'destaque' : ''}" data-indice="${indice}">
      ${selo}
      <img class="cf-carro-imagem" src="${carro.imagem}" alt="${carro.nome}" onerror="this.style.opacity='0.15'">
      <div class="cf-carro-nome">${carro.nome}${coroa}</div>
      <div class="cf-carro-resumo">${carro.resumo}</div>
      <div class="cf-carro-toque">TOQUE PRA VER</div>
    </button>`;
}

function abrirModalCarro(carro) {
  document.getElementById('cf-modal-imagem').src = carro.imagem;
  document.getElementById('cf-modal-imagem').alt = carro.nome;
  document.getElementById('cf-modal-nome').innerHTML = carro.nome + (carro.destaque ? ' 👑' : '');
  const precoFmt = carro.preco.toLocaleString('pt-BR');
  document.getElementById('cf-modal-requisito').textContent = carro.ligaMinima
    ? `🏅 Liga ${carro.ligaMinima}+ e 🪙 ${precoFmt} moedas`
    : `🪙 ${precoFmt} moedas`;
  document.getElementById('cf-modal-habilidade').innerHTML = carro.habilidade;
  document.getElementById('cf-modal-fundo').classList.add('aberto');
}
function fecharModalCarro() {
  document.getElementById('cf-modal-fundo').classList.remove('aberto');
}

function prepararComoFunciona() {
  const grid = document.getElementById('cf-carros-grid');
  grid.innerHTML = CARROS_VIP_INFO.map(cfCarroCardHtml).join('');
  grid.querySelectorAll('.cf-carro-card').forEach((el) => {
    el.addEventListener('click', () => abrirModalCarro(CARROS_VIP_INFO[Number(el.dataset.indice)]));
  });
  document.getElementById('cf-modal-fechar').addEventListener('click', fecharModalCarro);
  document.getElementById('cf-modal-fundo').addEventListener('click', (e) => {
    if (e.target.id === 'cf-modal-fundo') fecharModalCarro(); // clicou fora do card, fecha
  });
}

// ---------------------------------------------------------------------------
// início
// ---------------------------------------------------------------------------
async function iniciar() {
  configurarAbas();
  ['diario', 'semanal', 'mensal', 'ligas', 'moedas'].forEach(configurarBusca);
  atualizarContagens();
  setInterval(atualizarContagens, 30000); // atualiza a contagem regressiva a cada 30s
  prepararComoFunciona(); // conteúdo estático, monta uma vez só, não depende do Supabase

  const statusEl = document.getElementById('status-conexao');
  const resultados = await Promise.all([
    carregarRanking('diario'),
    carregarRanking('semanal'),
    carregarRanking('mensal'),
    carregarRanking('ligas'),
    carregarRanking('moedas'),
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
