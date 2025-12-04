import React, { useState, useEffect, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot } from 'firebase/firestore';
import { Loader2, Zap, BookOpen, User, LogOut, MessageSquare, Award, Lock, Brain, Video, ListTree, UserCheck, Clock } from 'lucide-react';

// --- CONFIGURAÇÕES E VARIÁVEIS GLOBAIS (FORNECIDAS PELO AMBIENTE) ---
const appId = typeof __app_id !== 'undefined' ? __app_id : 'edu-ia-app';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;
const API_KEY = "AIzaSyAv07meyWS_nrFLnA4ZvQV8nke4QttBquw";

// --- CONSTANTES DO APP ---
const FREE_USER_LIMIT = 5; // Limite de pesquisas para usuários gratuitos
const POINTS_PER_SEARCH = 10; // Pontos ganhos por pesquisa
const PREMIUM_ICON = <Zap className="w-4 h-4 text-yellow-400" />;

// Avatars e Recompensas (Gamificação)
const defaultAvatar = { icon: 'BookOpen', color: 'blue', isPremium: false };
const unlockableIcons = [
  { icon: 'Award', color: 'yellow', requiredPoints: 50, name: 'Estrela de Ouro' },
  { icon: 'Brain', color: 'purple', requiredPoints: 100, name: 'Gênio do Saber', isPremium: true },
  { icon: 'Zap', color: 'red', requiredPoints: 150, name: 'Eletrizante' },
  { icon: 'UserCheck', color: 'green', requiredPoints: 200, name: 'Mestre do Conteúdo', isPremium: true },
];

// --- FUNÇÕES DE UTILITY (API CALL) ---

/**
 * Converte um nome de string para o componente Icone correspondente do lucide-react.
 */
const getIconComponent = (iconName) => {
  const icons = { BookOpen, User, Zap, Award, Brain, UserCheck, ListTree, Video, Clock };
  return icons[iconName] || User;
};

/**
 * Implementa o backoff exponencial para chamadas à API.
 */
const fetchWithRetry = async (url, options, retries = 3) => {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) {
        return await response.json();
      }
      if (response.status === 429) { // Too Many Requests
        const delay = Math.pow(2, i) * 1000 + Math.random() * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      // Lança erro para status 4xx/5xx
      throw new Error(`Erro API: ${response.statusText}`);
    } catch (error) {
      if (i === retries - 1) throw error;
      // Retries will handle network errors or 429
    }
  }
};


// --- ESTRUTURA DE COMPONENTES ---

// 1. Componente de Botão Universal
const Button = ({ children, onClick, disabled, className = '' }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`w-full py-3 px-4 rounded-xl font-semibold transition-all duration-200 shadow-lg
      ${disabled ? 'bg-gray-400 text-gray-700 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700 text-white active:scale-95'}
      ${className}`}
  >
    {children}
  </button>
);

// 2. Tela de Login e Cadastro (Sem Alterações)
const AuthScreen = ({ auth, setAuthReady }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleAuthAction = async () => {
    setError('');
    setIsLoading(true);
    try {
      if (isLogin) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
      }
    } catch (err) {
      const msg = err.code.includes('auth/weak-password') ? 'Senha deve ter pelo menos 6 caracteres.' :
                  err.code.includes('auth/email-already-in-use') ? 'Este email já está em uso.' :
                  err.code.includes('auth/invalid-credential') ? 'Credenciais inválidas. Verifique seu email e senha.' :
                  'Erro de autenticação. Tente novamente.';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // Tenta fazer o login com o token inicial fornecido pelo ambiente Canvas
    const performInitialAuth = async () => {
      try {
        if (initialAuthToken) {
          await signInWithCustomToken(auth, initialAuthToken);
        } else {
          await signInAnonymously(auth);
        }
      } catch (e) {
        console.error("Erro na autenticação inicial:", e);
      } finally {
        setAuthReady(true);
      }
    };
    performInitialAuth();
  }, [auth, setAuthReady]);


  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gray-50">
      <div className="w-full max-w-sm bg-white p-8 rounded-2xl shadow-2xl border border-gray-100">
        <h1 className="text-3xl font-extrabold text-indigo-700 text-center mb-6">
          <Zap className="inline-block w-8 h-8 mr-2" />
          BrainUp IA
        </h1>
        <h2 className="text-xl font-semibold text-center text-gray-800 mb-8">
          {isLogin ? 'Fazer Login' : 'Criar Conta'}
        </h2>

        {error && (
          <div className="bg-red-100 text-red-700 p-3 rounded-xl mb-4 text-sm border border-red-200">
            {error}
          </div>
        )}

        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full p-3 mb-4 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 transition-shadow"
          disabled={isLoading}
        />
        <input
          type="password"
          placeholder="Senha"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full p-3 mb-6 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 transition-shadow"
          disabled={isLoading}
        />

        <Button onClick={handleAuthAction} disabled={isLoading}>
          {isLoading ? <Loader2 className="w-6 h-6 animate-spin mx-auto" /> : (isLogin ? 'Entrar' : 'Cadastrar')}
        </Button>

        <p className="text-center text-sm text-gray-500 mt-6">
          {isLogin ? 'Não tem uma conta?' : 'Já tem uma conta?'}
          <button
            onClick={() => setIsLogin(!isLogin)}
            className="text-indigo-600 hover:text-indigo-800 font-medium ml-1 transition-colors"
            disabled={isLoading}
          >
            {isLogin ? 'Crie uma agora' : 'Faça login'}
          </button>
        </p>
      </div>
    </div>
  );
};

// Componente para exibir uma mensagem da IA na conversa
const AIChatMessage = ({ entry, isLast = false }) => {
    const formatTime = (isoString) => {
        if (!isoString) return '';
        return new Date(isoString).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    };

    // Função para renderizar o bloco de sugestões
    const renderSuggestions = (suggestions, video) => (
        <div className="space-y-4 pt-4 border-t border-gray-100">
            <h4 className="font-bold text-lg text-indigo-700 flex items-center">
                <Brain className="w-5 h-5 mr-2" /> Próximos Passos de Aprendizado
            </h4>

            <div className="grid sm:grid-cols-2 gap-4">
                {suggestions.mindMapTitle && (
                    <div className="bg-purple-50 p-4 rounded-xl shadow-sm border border-purple-200">
                        <p className="font-semibold text-purple-700 flex items-center mb-1">
                            <ListTree className="w-4 h-4 mr-2" /> Mapa Mental
                        </p>
                        <p className="text-sm text-gray-700 font-medium">{suggestions.mindMapTitle}</p>
                    </div>
                )}
                {suggestions.dragAndDropTopic && (
                    <div className="bg-green-50 p-4 rounded-xl shadow-sm border border-green-200">
                        <p className="font-semibold text-green-700 flex items-center mb-1">
                            <ListTree className="w-4 h-4 mr-2" /> Arrasta e Solta (Conceitos)
                        </p>
                        <p className="text-sm text-gray-700 font-medium">{suggestions.dragAndDropTopic}</p>
                    </div>
                )}
            </div>
            {/* VÍDEO CURTO COM GROUNDING DO YOUTUBE */}
            {video.uri && video.title && (
                <div className="bg-red-50 p-4 rounded-xl shadow-sm border border-red-200">
                    <p className="font-semibold text-red-700 flex items-center mb-2">
                        <Video className="w-4 h-4 mr-2" /> Vídeo Curto Sugerido
                    </p>
                    <a href={video.uri} target="_blank" rel="noopener noreferrer" className="block hover:opacity-80 transition-opacity">
                        <img
                            src={`https://placehold.co/128x72/2563EB/FFFFFF?text=YouTube`} // Placeholder
                            alt={`[Imagem do vídeo: ${video.title}]`}
                            className="rounded-lg w-full max-w-sm h-auto object-cover mb-2 border border-red-300"
                        />
                        <p className="text-sm font-semibold text-indigo-800">{video.title}</p>
                        <p className="text-xs text-gray-600">Canal: {video.author || "YouTube"}</p>
                    </a>
                </div>
            )}
        </div>
    );

    return (
        <div className={`p-6 rounded-2xl shadow-lg border border-gray-200 space-y-4 ${isLast ? 'bg-white' : 'bg-gray-50'}`}>
            {/* Bloco da Pergunta do Usuário */}
            <div className="flex justify-between items-start border-b pb-2 mb-4">
                <p className="text-sm font-semibold text-indigo-600">Você perguntou:</p>
                <span className="text-xs text-gray-500">{formatTime(entry.timestamp)}</span>
            </div>
            <p className="text-lg font-medium text-gray-800 italic">"{entry.query}"</p>

            {/* Bloco de Resposta da IA */}
            <h3 className="text-xl font-bold text-indigo-700 border-t pt-4">Resposta do Tutor:</h3>
            <p className="text-gray-700 whitespace-pre-wrap">{entry.answer}</p>

            {/* Quiz (Mini-game) */}
            {entry.quiz && (
                <div className="bg-yellow-50 p-5 rounded-xl border border-yellow-200 shadow-md">
                    <h4 className="font-bold text-lg text-yellow-800 flex items-center mb-3">
                        <BookOpen className="w-5 h-5 mr-2" /> Mini-Game: Quiz!
                    </h4>
                    <p className="font-medium mb-3 text-gray-800">{entry.quiz.question}</p>
                    {entry.quiz.options.map((option, index) => (
                        <div key={index} className="flex items-center mb-2">
                            <span className={`w-6 h-6 flex items-center justify-center mr-3 font-bold text-white rounded-full 
                              ${index === entry.quiz.correctOptionIndex ? 'bg-green-500' : 'bg-gray-400'}`}>
                                {String.fromCharCode(65 + index)}
                            </span>
                            <span className={`${index === entry.quiz.correctOptionIndex ? 'font-semibold text-green-700' : 'text-gray-600'}`}>
                                {option}
                            </span>
                        </div>
                    ))}
                </div>
            )}

            {/* Sugestões de Conteúdo (com YouTube) */}
            {entry.suggestions && renderSuggestions(entry.suggestions, entry.video || {})}
        </div>
    );
};

// 3. Componente de Chat e IA (Núcleo do App) - Refatorado para Conversa
const AIChat = ({ db, userProfile, updateProfile }) => {
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [modalMessage, setModalMessage] = useState(null);

  const history = userProfile?.history || [];

  const isPremium = userProfile?.isPremium || false;
  const isSearchAllowed = isPremium || userProfile?.searchCount < FREE_USER_LIMIT;
  const searchesLeft = isPremium ? 'Ilimitado' : FREE_USER_LIMIT - (userProfile?.searchCount || 0);

  const showModal = (title, body) => {
    setModalMessage({ title, body });
    setTimeout(() => setModalMessage(null), 5000); // Fecha após 5s
  };

  const handleAISearch = async (e) => {
    e.preventDefault();
    if (!query || isLoading || !isSearchAllowed) return;

    setIsLoading(true);

    try {
      // FIX: Simplificando a query do usuário e tornando a instrução do sistema mais estrita
      const userQuery = query; 
      const systemInstruction = "Você é um Tutor de IA. Gere APENAS um JSON estrito. No campo 'answer', forneça uma resposta informativa e completa em Português do Brasil para a pergunta do usuário. O restante do JSON deve incluir um QUIZ de múltipla escolha com 4 opções, um título de MAPA MENTAL, um assunto de VÍDEO CURTO (para busca no YouTube) e um tópico de ARRASTA E SOLTA, todos estritamente no formato JSON fornecido.";

      const payload = {
        contents: [{ parts: [{ text: userQuery }] }],
        systemInstruction: { parts: [{ text: systemInstruction }] },
        tools: [{ "google_search": {} }], // Adiciona o Google Search para grounding
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              answer: { type: "STRING", description: "Resposta completa e concisa em Português." },
              quiz: {
                type: "OBJECT",
                properties: {
                  question: { type: "STRING" },
                  options: { type: "ARRAY", items: { type: "STRING" } },
                  correctOptionIndex: { type: "NUMBER", description: "Índice (0 a 3) da resposta correta." }
                }
              },
              learningSuggestions: {
                type: "OBJECT",
                properties: {
                  mindMapTitle: { type: "STRING", description: "Título para um mapa mental relacionado." },
                  videoSubject: { type: "STRING", description: "Assunto para um vídeo curto didático." },
                  dragAndDropTopic: { type: "STRING", description: "Tópico para um jogo de arrasta e solta." }
                }
              }
            }
          }
        },
      };

      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${API_KEY}`;
      const apiResponse = await fetchWithRetry(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const result = apiResponse.candidates?.[0];
      const jsonText = result?.content?.parts?.[0]?.text;
      
      // Safety check antes de tentar o parse
      if (!jsonText) {
          throw new Error("Resposta da IA vazia ou malformada.");
      }
      
      const parsedData = JSON.parse(jsonText);

      let youtubeSource = { uri: null, title: null, author: null };
      
      // Procura por link do YouTube nos metadados de grounding
      const groundingMetadata = result?.groundingMetadata;
      if (groundingMetadata && groundingMetadata.groundingAttributions) {
          const youtubeAttribution = groundingMetadata.groundingAttributions.find(attr => 
              attr.web?.uri && attr.web.uri.includes('youtube.com')
          );

          if (youtubeAttribution) {
              youtubeSource.uri = youtubeAttribution.web.uri;
              youtubeSource.title = youtubeAttribution.web.title;
              youtubeSource.author = youtubeAttribution.web.publisher || "YouTube Channel"; 
          }
      }

      // 4. Criação da Entrada no Histórico
      const newHistoryEntry = {
          query: query,
          answer: parsedData.answer || "Resposta não gerada.",
          quiz: parsedData.quiz,
          suggestions: parsedData.learningSuggestions,
          video: youtubeSource, 
          timestamp: new Date().toISOString()
      };

      // 5. Atualiza o Perfil no Firestore (Gamificação e Freemium)
      const newSearchCount = userProfile.searchCount + 1;
      const newPoints = userProfile.points + POINTS_PER_SEARCH;
      
      const currentHistory = userProfile.history || [];
      const newHistory = [newHistoryEntry, ...currentHistory].slice(0, 100); 
      
      // Lógica de contagem de assunto (simples: primeira palavra da query)
      const subjectKey = query.trim().split(/\s+/)[0].toLowerCase();
      const currentSubjects = userProfile.subjectCounts || {};
      const newSubjectCounts = {
          ...currentSubjects,
          [subjectKey]: (currentSubjects[subjectKey] || 0) + 1
      };

      await updateProfile({
        searchCount: newSearchCount,
        points: newPoints,
        history: newHistory,
        subjectCounts: newSubjectCounts
      });

      setQuery(''); 
      showModal('Sucesso!', `Você ganhou ${POINTS_PER_SEARCH} pontos por sua pesquisa.`);

    } catch (err) {
      console.error('Erro ao chamar a API Gemini:', err);
      showModal('Erro na IA', 'Não foi possível processar a requisição. Tente novamente.');
      // Adiciona uma mensagem de erro ao histórico para feedback
      const errorEntry = {
        query: query,
        answer: "Ops! Ocorreu um erro ao gerar o conteúdo ou conectar com a IA. Tente novamente.",
        quiz: null,
        suggestions: null,
        video: {},
        timestamp: new Date().toISOString()
      };
      await updateProfile({ history: [errorEntry, ...history].slice(0, 100) });

    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-[80vh] bg-white rounded-2xl shadow-xl">
        {/* Header */}
        <div className="p-4 sm:p-6 border-b">
            <h2 className="text-2xl font-bold text-gray-800 flex items-center">
                <MessageSquare className="w-6 h-6 mr-2 text-indigo-600" />
                Tutor IA (Chat)
            </h2>
            <div className="mt-2 p-3 bg-indigo-50 border border-indigo-200 rounded-xl text-sm font-medium">
                {isPremium ? (
                  <p className="text-indigo-700 flex items-center">
                    {PREMIUM_ICON}
                    <span className="ml-2">Status Premium: Pesquisas Ilimitadas.</span>
                  </p>
                ) : (
                  <p className="text-gray-700">
                    Pesquisas Gratuitas Restantes: <span className="font-bold">{searchesLeft}</span> de {FREE_USER_LIMIT}
                  </p>
                )}
            </div>
        </div>

        {/* Modal de Mensagem */}
        {modalMessage && (
            <div className="fixed top-4 right-4 bg-green-100 text-green-800 p-4 rounded-xl shadow-lg z-50 transition-transform animate-slide-in">
                <p className="font-semibold">{modalMessage.title}</p>
                <p className="text-sm">{modalMessage.body}</p>
            </div>
        )}

        {/* Histórico de Conversa */}
        <div id="chat-history" className="flex-grow overflow-y-auto p-4 sm:p-6 space-y-6">
            {history.length === 0 && (
                <div className="text-center p-12 text-gray-500 italic">
                    <MessageSquare className="w-10 h-10 mx-auto mb-3" />
                    Comece sua primeira conversa. A IA irá gerar a resposta e mini-games!
                </div>
            )}
            {history.map((entry, index) => (
                <AIChatMessage key={index} entry={entry} isLast={index === 0} />
            ))}

            {/* Indicador de Loading */}
            {isLoading && (
                <div className="text-center p-4 bg-white rounded-xl shadow-inner">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto text-indigo-500 mb-1" />
                    <p className="text-sm text-gray-600">A IA está processando...</p>
                </div>
            )}
        </div>

        {/* Formulário de Pesquisa (Input Fixo) */}
        <form onSubmit={handleAISearch} className="p-4 sm:p-6 border-t bg-gray-50 flex flex-col gap-3">
            <textarea
                placeholder="Digite sua próxima dúvida aqui..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                rows="2"
                className="w-full p-3 border border-gray-300 rounded-xl resize-none focus:ring-2 focus:ring-indigo-500 transition-shadow shadow-sm"
                disabled={isLoading || !isSearchAllowed}
            />
            <Button onClick={handleAISearch} disabled={isLoading || !isSearchAllowed || !query} className="py-2">
                {isLoading ? 'Enviando...' : 'Perguntar'}
            </Button>
            {!isSearchAllowed && !isPremium && (
              <p className="text-red-500 text-xs text-center">
                Limite de pesquisas atingido. Faça upgrade para Premium.
              </p>
            )}
        </form>
    </div>
  );
};


// 4. Componente de Perfil e Gamificação - ATUALIZADO
const ProfileDisplay = ({ userProfile, userId, updateProfile }) => {
  const IconComponent = getIconComponent(userProfile?.avatarIcon || defaultAvatar.icon);
  const userColor = userProfile?.avatarColor || defaultAvatar.color;
  const userPoints = userProfile?.points || 0;
  const isPremium = userProfile?.isPremium || false;

  const handleIconUnlock = async (icon) => {
    if (userPoints >= icon.requiredPoints) {
      // Desbloquear e aplicar
      await updateProfile({ avatarIcon: icon.icon, avatarColor: icon.color });
    } else {
      console.log('Pontos insuficientes!');
    }
  };

  const handlePremiumUpgrade = async () => {
    // Simulação: Apenas ativa o status premium
    await updateProfile({ isPremium: true });
  };

  // --- LÓGICA DE ESTATÍSTICAS ---
  const subjectCounts = userProfile?.subjectCounts || {};
  let mostResearchedSubject = 'Nenhuma';
  let maxCount = 0;

  for (const subject in subjectCounts) {
    if (subjectCounts[subject] > maxCount && subject.length > 0) {
      maxCount = subjectCounts[subject];
      // Capitaliza a primeira letra para exibição
      mostResearchedSubject = subject.charAt(0).toUpperCase() + subject.slice(1);
    }
  }

  const lastSearches = (userProfile?.history || []).slice(0, 10);
  const totalSearches = userProfile?.searchCount || 0;

  return (
    <div className="p-4 sm:p-6 space-y-6 bg-white rounded-2xl shadow-xl">
      <h2 className="text-2xl font-bold text-gray-800 border-b pb-2 flex items-center">
        <User className="w-6 h-6 mr-2 text-indigo-600" />
        Meu Perfil de Estudante
      </h2>

      {/* Display do Avatar e Pontuação */}
      <div className="flex flex-col sm:flex-row items-center gap-6 p-4 bg-indigo-50 border border-indigo-200 rounded-xl">
        <div className={`p-4 rounded-full shadow-lg ${isPremium ? 'border-4 border-yellow-400 bg-white' : 'bg-white'}`}>
          <IconComponent className={`w-12 h-12 text-${userColor}-500`} />
        </div>
        <div className="flex-grow">
          <p className="text-lg font-bold text-gray-800">ID do Usuário: {userId}</p>
          <div className="flex items-center text-xl font-extrabold text-indigo-600 mt-1">
            <Award className="w-6 h-6 mr-2 text-yellow-500" />
            {userPoints} Pontos
          </div>
          <p className="text-sm text-gray-500 mt-2">
             Status: {isPremium ? <span className="font-semibold text-yellow-600">Premium {PREMIUM_ICON}</span> : 'Gratuito'}
          </p>
        </div>
      </div>

      {/* NOVO: Matéria Mais Pesquisada e Total de Pesquisas */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 bg-gray-100 rounded-xl border border-gray-200">
        <div className="bg-white p-3 rounded-lg shadow-sm">
            <p className="text-sm font-semibold text-gray-600 mb-1">Matéria Mais Pesquisada:</p>
            <p className="text-xl font-bold text-indigo-700">{mostResearchedSubject}</p>
        </div>
        <div className="bg-white p-3 rounded-lg shadow-sm">
            <p className="text-sm font-semibold text-gray-600 mb-1">Total de Pesquisas:</p>
            <p className="text-xl font-bold text-indigo-700">{totalSearches}</p>
        </div>
      </div>
      {/* FIM NOVO: Matéria Mais Pesquisada */}

      {/* Gamificação: Recompensas e Desbloqueios */}
      <div className="space-y-4">
        <h3 className="text-xl font-bold text-gray-700">Desbloqueio de Ícones</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {unlockableIcons.map((icon, index) => {
            const CurrentIcon = getIconComponent(icon.icon);
            const isUnlocked = userPoints >= icon.requiredPoints;
            const isCurrent = userProfile.avatarIcon === icon.icon;

            return (
              <div
                key={index}
                className={`flex flex-col items-center p-3 rounded-xl shadow-md cursor-pointer transition-all duration-200
                  ${isUnlocked
                    ? (isCurrent ? 'bg-indigo-200 ring-2 ring-indigo-500' : 'bg-white hover:bg-gray-100')
                    : 'bg-gray-200 opacity-60'
                  }`}
                onClick={isUnlocked && !isCurrent ? () => handleIconUnlock(icon) : null}
              >
                <div className={`p-2 rounded-full ${isUnlocked ? `bg-${icon.color}-500/20` : 'bg-gray-300'}`}>
                  {isUnlocked ? (
                    <CurrentIcon className={`w-8 h-8 text-${icon.color}-500`} />
                  ) : (
                    <Lock className="w-8 h-8 text-gray-500" />
                  )}
                </div>
                <p className="text-xs font-semibold mt-2 text-center text-gray-800">{icon.name}</p>
                <p className={`text-xs ${isUnlocked ? 'text-green-600' : 'text-gray-500'}`}>
                  {isUnlocked ? 'Desbloqueado' : `${icon.requiredPoints} Pontos`}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Área Premium (Sem Alterações) */}
      {!isPremium && (
        <div className="p-5 bg-yellow-50 border border-yellow-300 rounded-xl shadow-lg">
          <h3 className="text-xl font-bold text-yellow-800 flex items-center mb-2">
            <Zap className="w-6 h-6 mr-2" />
            Recursos Premium
          </h3>
          <p className="text-sm text-gray-700 mb-4">
            Desbloqueie pesquisas ilimitadas e o ícone 'Gênio do Saber'!
          </p>
          <Button onClick={handlePremiumUpgrade} className="bg-yellow-500 hover:bg-yellow-600">
            Fazer Upgrade (Simulação)
          </Button>
        </div>
      )}

      {/* NOVO: Últimas 10 Perguntas */}
      <div className="space-y-4 pt-4 border-t border-gray-100">
        <h3 className="text-xl font-bold text-gray-700 flex items-center">
            <Clock className="w-5 h-5 mr-2" /> Últimas 10 Perguntas
        </h3>
        {lastSearches.length > 0 ? (
            <div className="space-y-3">
                {lastSearches.map((search, index) => (
                    <div key={index} className="bg-white p-3 rounded-lg shadow-sm border border-gray-100 hover:bg-gray-50">
                        <p className="text-sm font-semibold text-indigo-600 truncate">P: {search.query}</p>
                        <p className="text-xs text-gray-500 mt-1 line-clamp-2">R: {search.answer}</p>
                    </div>
                ))}
            </div>
        ) : (
            <p className="text-gray-500 text-sm italic">Nenhuma pesquisa registrada ainda.</p>
        )}
      </div>
    </div>
  );
};

// 5. Partida Final (Simples - Sem Alterações)
const FinalMatch = () => {
    const [status, setStatus] = useState('pending'); // pending, started, finished
    const [score, setScore] = useState(0);

    const startMatch = () => {
        setStatus('started');
        setScore(0);
        // Em um app real, aqui carregaria 10 perguntas de revisão
    };

    const finishMatch = () => {
        setStatus('finished');
        // Em um app real, o score seria calculado e os pontos seriam dados.
        setScore(Math.floor(Math.random() * 50) + 50); // Simula pontuação alta
    };

    return (
        <div className="p-4 sm:p-6 space-y-6 bg-white rounded-2xl shadow-xl">
            <h2 className="text-2xl font-bold text-gray-800 flex items-center border-b pb-2">
                <Brain className="w-6 h-6 mr-2 text-green-600" />
                Partida Final (Revisão)
            </h2>

            {status === 'pending' && (
                <div className="text-center p-8 bg-green-50 border border-green-200 rounded-xl">
                    <p className="text-lg font-semibold text-gray-700 mb-4">
                        Reúna todo o conhecimento! Esta partida revisa o conteúdo para consolidar seu aprendizado.
                    </p>
                    <Button onClick={startMatch} className="w-auto px-8 bg-green-600 hover:bg-green-700">
                        Começar Revisão
                    </Button>
                </div>
            )}

            {status === 'started' && (
                <div className="p-5 bg-yellow-50 rounded-xl">
                    <p className="font-bold text-lg text-yellow-800">Fase de Revisão em Andamento...</p>
                    <p className="text-sm text-gray-700 mt-2">
                        (Simulação: Aqui estaria o quiz interativo com perguntas sobre o conteúdo que você estudou.)
                    </p>
                    <Button onClick={finishMatch} className="mt-4 w-auto px-8 bg-orange-500 hover:bg-orange-600">
                        Finalizar Partida (Simulação)
                    </Button>
                </div>
            )}

            {status === 'finished' && (
                <div className="text-center p-8 bg-green-100 border border-green-400 rounded-xl">
                    <h3 className="text-2xl font-bold text-green-700">Revisão Concluída!</h3>
                    <p className="text-3xl font-extrabold text-green-600 my-4">{score} Pontos!</p>
                    <p className="text-gray-700">Você revisou o conteúdo com sucesso e ganhou pontos de bônus!</p>
                    <Button onClick={() => setStatus('pending')} className="mt-4 w-auto px-8">
                        Voltar
                    </Button>
                </div>
            )}
        </div>
    );
};


// 6. Componente Principal do App (Após Login - Sem Alterações)
const MainAppScreen = ({ auth, db, userId, userProfile, updateProfile }) => {
  const [activeTab, setActiveTab] = useState('ia');

  const navItems = [
    { id: 'ia', label: 'Tutor IA', icon: MessageSquare, component: AIChat },
    { id: 'match', label: 'Partida Final', icon: Zap, component: FinalMatch },
    { id: 'profile', label: 'Perfil', icon: User, component: ProfileDisplay },
  ];

  const ActiveComponent = navItems.find(item => item.id === activeTab).component;

  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch (e) {
      console.error("Erro ao sair:", e);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-gray-100">
      {/* Header Fixo */}
      <header className="bg-white shadow-md p-4 flex justify-between items-center sticky top-0 z-10">
        <h1 className="text-xl font-extrabold text-indigo-700">BrainUp IA</h1>
        <button onClick={handleSignOut} className="text-gray-500 hover:text-red-600 transition-colors flex items-center text-sm">
          <LogOut className="w-5 h-5 mr-1" /> Sair
        </button>
      </header>

      {/* Conteúdo Principal */}
      <main className="flex-grow p-4 sm:p-8 overflow-y-auto">
        <div className="max-w-4xl mx-auto">
          {/* Renderiza o Componente Ativo */}
          <ActiveComponent db={db} userProfile={userProfile} userId={userId} updateProfile={updateProfile} />
        </div>
      </main>

      {/* Navegação Inferior (Mobile Friendly) */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-2xl sm:static sm:max-w-4xl sm:mx-auto">
        <div className="flex justify-around py-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`flex flex-col items-center p-2 rounded-xl transition-colors duration-150 ${
                  isActive ? 'text-indigo-600 bg-indigo-50' : 'text-gray-500 hover:text-indigo-600 hover:bg-gray-50'
                }`}
              >
                <Icon className="w-6 h-6" />
                <span className="text-xs mt-1 font-medium hidden sm:block">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Estilos para o Modal de Mensagem */}
      <style>{`
        @keyframes slideIn {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
        .animate-slide-in {
          animation: slideIn 0.3s ease-out forwards;
        }
      `}</style>
    </div>
  );
};


// 7. Componente Raiz (Gerencia Firebase e Estado Global) - ATUALIZADO
const App = () => {
  const [app, setApp] = useState(null);
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [user, setUser] = useState(null); // Objeto de usuário do Firebase Auth
  const [userId, setUserId] = useState(null); // ID do usuário ou anônimo
  const [userProfile, setUserProfile] = useState(null); // Perfil do Firestore
  const [authReady, setAuthReady] = useState(false);
  const [isProfileLoading, setIsProfileLoading] = useState(true);

  // 7.1. Inicialização do Firebase e Autenticação (Sem Alterações)
  useEffect(() => {
    if (Object.keys(firebaseConfig).length === 0) {
      console.error("Configuração do Firebase não encontrada. O aplicativo não funcionará corretamente.");
      return;
    }

    const appInstance = initializeApp(firebaseConfig);
    const authInstance = getAuth(appInstance);
    const dbInstance = getFirestore(appInstance);

    setApp(appInstance);
    setAuth(authInstance);
    setDb(dbInstance);

    // Listener de estado de autenticação
    const unsubscribe = onAuthStateChanged(authInstance, (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        // Usa o UID real para usuários logados/criados
        setUserId(currentUser.uid);
      } else {
        // Se deslogado, volta para a tela de Auth
        setUserId(null);
        setUserProfile(null);
      }
      setAuthReady(true);
    });

    return () => unsubscribe();
  }, []);

  // 7.2. Lógica de Perfil (Firestore) - ATUALIZADO
  useEffect(() => {
    if (db && userId) {
      setIsProfileLoading(true);
      const profilePath = `/artifacts/${appId}/users/${userId}/data/userProfile`;
      const profileRef = doc(db, profilePath);

      // Listener em tempo real para o perfil
      const unsubscribeProfile = onSnapshot(profileRef, async (docSnapshot) => {
        if (docSnapshot.exists()) {
          setUserProfile(docSnapshot.data());
          setIsProfileLoading(false);
        } else {
          // Cria o perfil inicial se não existir
          const initialProfile = {
            points: 0,
            searchCount: 0,
            isPremium: false,
            avatarIcon: defaultAvatar.icon,
            avatarColor: defaultAvatar.color,
            createdAt: new Date().toISOString(),
            history: [], // NOVO: Histórico de pesquisas
            subjectCounts: {}, // NOVO: Contagem de assuntos
            userId: userId,
          };
          try {
            await setDoc(profileRef, initialProfile, { merge: true });
            setUserProfile(initialProfile);
          } catch (e) {
            console.error("Erro ao criar perfil inicial:", e);
          } finally {
            setIsProfileLoading(false);
          }
        }
      }, (error) => {
        console.error("Erro ao ouvir o perfil:", error);
        setIsProfileLoading(false);
      });

      return () => unsubscribeProfile();
    }
  }, [db, userId]);

  // Função para atualizar o perfil no Firestore (Sem Alterações)
  const updateProfile = useCallback(async (updates) => {
    if (!db || !userId) return;
    const profilePath = `/artifacts/${appId}/users/${userId}/data/userProfile`;
    const profileRef = doc(db, profilePath);
    try {
      await setDoc(profileRef, updates, { merge: true });
    } catch (e) {
      console.error("Erro ao atualizar perfil:", e);
    }
  }, [db, userId]);


  if (!authReady || !auth) {
    // Mostra tela de carregamento ou inicia a autenticação
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
        <p className="ml-3 text-lg font-medium text-gray-700">Carregando...</p>
      </div>
    );
  }

  if (!user || !userId) {
    // Redireciona para a tela de Login/Cadastro
    return <AuthScreen auth={auth} setAuthReady={setAuthReady} />;
  }

  if (isProfileLoading || !userProfile) {
      // Carregando o perfil após o login
      return (
          <div className="min-h-screen flex items-center justify-center bg-gray-50">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
              <p className="ml-3 text-lg font-medium text-gray-700">Carregando perfil do usuário...</p>
          </div>
      );
  }

  // Renderiza a Aplicação Principal
  return (
    <MainAppScreen
      auth={auth}
      db={db}
      userId={userId}
      userProfile={userProfile}
      updateProfile={updateProfile}
    />
  );
};

export default App;
