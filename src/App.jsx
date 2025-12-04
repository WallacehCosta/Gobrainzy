/* global __app_id, __firebase_config, __initial_auth_token, katex */
/* eslint-disable no-unused-vars */

import React, { useState, useEffect, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot, updateDoc} from 'firebase/firestore';
import { increment } from 'firebase/firestore';
import { Loader2, Zap, BookOpen, User, LogOut, MessageSquare, Award, Lock, Brain, Video, ListTree, UserCheck, Search, Clock, Hash } from 'lucide-react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import './index.css';
import MentalMap from './MentalMap';


// --- CONFIGURAÇÕES E VARIÁVEIS GLOBAIS (FORNECIDAS PELO AMBIENTE) ---
const appId = "edu-ia-app";
const firebaseConfig = {

  apiKey: "AIzaSyAJAAPjChlSK33oxlVX7Xu8BIgGeCaMdBQ",
  authDomain: "ai-estudantil.firebaseapp.com",
  projectId: "ai-estudantil",
  storageBucket: "ai-estudantil.appspot.com",
  messagingSenderId: "949660718945",
  appId: "1:949660718945:web:ad05fcfcec18997f5f9720",
  measurementId: "G-B31BZDVF2X"
};

const initialAuthToken = null;
const API_KEY = "AIzaSyAv07meyWS_nrFLnA4ZvQV8nke4QttBquw"; 

// --- CONSTANTES DO APP ---
const FREE_USER_LIMIT = 5; // Limite de pesquisas para usuários gratuitos
// PONTUAÇÕES AJUSTADAS PARA QUIZ
const POINTS_PER_CORRECT_ANSWER = 15; // Pontos ganhos por acerto no quiz
const POINTS_PER_WRONG_ANSWER = -5;  // Pontos perdidos por erro no quiz
const POINTS_PER_SEARCH_ACTIVITY = 1; // 1 ponto por atividade de pesquisa
const PREMIUM_ICON = <Zap className="w-4 h-4 text-yellow-400" />;

// Avatars e Recompensas (Gamificação)
const defaultAvatar = { icon: 'BookOpen', color: 'blue', isPremium: false };
// PONTUAÇÕES DE DESBLOQUEIO ATUALIZADAS
const unlockableIcons = [
  { icon: 'Award', color: 'yellow', requiredPoints: 100, name: 'Estrela de Ouro' },
  { icon: 'Brain', color: 'purple', requiredPoints: 250, name: 'Gênio do Saber', isPremium: true },
  { icon: 'Zap', color: 'red', requiredPoints: 500, name: 'Eletrizante' },
  { icon: 'UserCheck', color: 'green', requiredPoints: 1000, name: 'Mestre do Conteúdo', isPremium: true },
];

/* ------------------------------
   PersistentQuiz component
   - persists selected option into userProfile.chatHistory[messageIndex].suggestions.quizStates
   - applies points change once, idempotent
   - restores user choice from persisted state
   - optimistic UI, rolls back on persist error
------------------------------ */
const PersistentQuiz = ({ quizzes = [], messageIndex, userProfile, updateProfile }) => {
  // Build initialQuizStates from persisted chatHistory if present
  const persisted =
    userProfile?.chatSessions?.find(s => s.id === userProfile?.currentSessionId)
      ?.chatHistory?.[messageIndex]?.suggestions?.quizStates;

  const defaultStates = quizzes.map(() => ({
    selectedOption: null,
    isAnswered: false,
    feedback: null,
  }));

  const initialQuizStates = Array.isArray(persisted) && persisted.length === quizzes.length
    ? persisted
    : defaultStates;

  const [quizStates, setQuizStates] = React.useState(initialQuizStates);
  const [totalScore, setTotalScore] = React.useState(() => {
    // compute initial score from persisted states
    let s = 0;
    initialQuizStates.forEach((st, i) => {
      if (st?.isAnswered) {
        const correct = quizzes[i]?.correctOptionIndex;
        if (st.selectedOption === correct) s += POINTS_PER_CORRECT_ANSWER;
        else s += POINTS_PER_WRONG_ANSWER;
      }
    });
    return s;
  });

  // Helper: persist quizStates into userProfile.chatSessions -> chatHistory[messageIndex].suggestions.quizStates
  const persistQuizStates = async (newStates, scoreDelta) => {
    if (!userProfile || typeof updateProfile !== 'function') {
      // no persistence available
      return { ok: false, error: 'no profile/updateProfile' };
    }

    // Build updated chatHistory (edit the message at messageIndex)
    // We assume current session exists and structure matches code elsewhere
    const sessions = userProfile.chatSessions || [];
    const sessionIndex = sessions.findIndex(s => s.id === userProfile.currentSessionId);
    if (sessionIndex === -1) {
      return { ok: false, error: 'session not found' };
    }

    const updatedSessions = [...sessions];
    const session = { ...updatedSessions[sessionIndex] };
    const chatHistory = Array.isArray(session.chatHistory) ? [...session.chatHistory] : [];

    // ensure messageIndex is valid
    if (messageIndex < 0 || messageIndex >= chatHistory.length) {
      return { ok: false, error: 'invalid messageIndex' };
    }

    // update quizStates inside suggestions
    const message = { ...chatHistory[messageIndex] };
    const suggestions = { ...(message.suggestions || {}) };
    suggestions.quizStates = newStates;
    message.suggestions = suggestions;
    chatHistory[messageIndex] = message;

    session.chatHistory = chatHistory;
    updatedSessions[sessionIndex] = session;

    // also apply points change to userProfile.points so global points update is persisted
    const newPoints = Math.max(0, (userProfile.points || 0) + scoreDelta);

    const updates = {
      chatSessions: updatedSessions,
      points: newPoints,
    };

    try {
      await updateProfile(updates);
      return { ok: true };
    } catch (err) {
      console.error('persistQuizStates failed', err);
      return { ok: false, error: err };
    }
  };

  const handleAnswer = async (quizIndex, selectedIndex) => {
    // Prevent double-answering
    if (quizStates[quizIndex]?.isAnswered) return;

    const correctIndex = quizzes[quizIndex]?.correctOptionIndex;
    const isCorrect = selectedIndex === correctIndex;
    const scoreChange = isCorrect ? POINTS_PER_CORRECT_ANSWER : POINTS_PER_WRONG_ANSWER;
    const feedback = isCorrect
      ? `Correto! Ganhou ${POINTS_PER_CORRECT_ANSWER} pontos.`
      : `Errado. Perdeu ${Math.abs(POINTS_PER_WRONG_ANSWER)} pontos.`;

    // Prepare new states (immutable)
    const newStates = quizStates.map((s, i) =>
      i === quizIndex ? { selectedOption: selectedIndex, isAnswered: true, feedback } : s
    );

    // Optimistic UI update
    setQuizStates(newStates);
    setTotalScore(prev => prev + scoreChange);

    // Persist to backend
    const res = await persistQuizStates(newStates, scoreChange);
    if (!res.ok) {
      // rollback optimistic update if persist failed
      setQuizStates(prev => {
        const rollback = [...prev];
        rollback[quizIndex] = { selectedOption: null, isAnswered: false, feedback: null };
        return rollback;
      });
      setTotalScore(prev => prev - scoreChange);
      // optional: show modal or console
      console.error('Failed to persist quiz answer:', res.error);
    }
  };

  return (
    <div className="space-y-4 bg-yellow-50 p-4 rounded-lg border border-yellow-200">
      {quizzes.map((q, qi) => {
        const state = quizStates[qi] || { selectedOption: null, isAnswered: false, feedback: null };
        const correctIndex = q.correctOptionIndex;
        return (
          <div key={qi} className="p-3 bg-white rounded-lg shadow-sm border border-gray-100">
            <p className="font-medium mb-3">{qi + 1}. {q.question}</p>

            <div className="space-y-2">
              {q.options.map((opt, oi) => {
                const isSelected = state.selectedOption === oi;
                const isCorrectOption = oi === correctIndex;

                let optionClass = 'text-gray-600 border-gray-300 hover:bg-gray-50';
                if (state.isAnswered) {
                  if (isCorrectOption) {
                    optionClass = 'bg-green-100 text-green-800 border-green-400 font-semibold';
                  } else if (isSelected) {
                    optionClass = 'bg-red-100 text-red-800 border-red-400 line-through';
                  } else {
                    optionClass = 'text-gray-500 border-gray-200 cursor-not-allowed';
                  }
                } else {
                  optionClass += ' hover:border-indigo-500 cursor-pointer';
                }

                return (
                  <div
                    key={oi}
                    onClick={() => !state.isAnswered && handleAnswer(qi, oi)}
                    className={`flex items-start p-3 rounded-xl border transition-all duration-200 ${optionClass}`}
                  >
                    <span className={`flex-shrink-0 w-5 h-5 flex items-center justify-center mr-3 font-bold text-xs rounded-full 
                      ${state.isAnswered && isCorrectOption ? 'bg-green-600' : 'bg-indigo-500'} text-white`}>
                      {String.fromCharCode(65 + oi)}
                    </span>
                    <span className="text-sm">{opt}</span>
                  </div>
                );
              })}
            </div>

            {state.feedback && (
              <div className={`mt-3 p-2 rounded-lg text-sm font-semibold ${state.selectedOption === quizzes[qi].correctOptionIndex ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                {state.feedback}
              </div>
            )}
          </div>
        );
      })}

      <div className="pt-4 border-t border-yellow-300">
        <p className="text-md font-bold text-yellow-800">
          Pontuação deste quiz: <span className="text-indigo-600">{totalScore}</span> pontos
        </p>
      </div>
    </div>
  );
};


// --- FUNÇÕES DE UTILITY (API CALL) ---

/**
 * Converte um nome de string para o componente Icone correspondente do lucide-react.
 */
const getIconComponent = (iconName) => {
  const icons = { BookOpen, User, Zap, Award, Brain, UserCheck, ListTree, Video };
  return icons[iconName] || User;
};

/**
 * Implementa o backoff exponencial para chamadas à API.
 */
const fetchWithRetry = async (url, options, retries = 3) => {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);

      // Se a resposta não for ok, tenta novamente
      if (!response.ok) {
        console.warn(`Tentativa ${i + 1}: Erro ${response.status} - ${response.statusText}`);
        if (response.status === 429) { // Too Many Requests
          const delay = Math.pow(2, i) * 1000 + Math.random() * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        // Se for outro erro, tenta novamente após pequeno delay
        await new Promise(resolve => setTimeout(resolve, 500));
        continue;
      }

      // Retorna o JSON corretamente parseado
      return await response.json();

    } catch (error) {
      console.error(`Tentativa ${i + 1} falhou:`, error);
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  throw new Error("Falha ao buscar após múltiplas tentativas.");
};


/**
 * UTILITY: Encontra o tópico mais frequente em uma lista de strings.
 */
const findMostFrequentTopic = (topics) => {
    if (!topics || topics.length === 0) return 'Nenhum';

    const counts = {};
    let maxCount = 0;
    let mostFrequent = '';

    for (const topic of topics) {
        // Normaliza para contagem mais limpa
        const cleanTopic = topic.trim().toLowerCase();
        counts[cleanTopic] = (counts[cleanTopic] || 0) + 1;
        if (counts[cleanTopic] > maxCount) {
            maxCount = counts[cleanTopic];
            mostFrequent = topic; // Usa a string original para exibição
        }
    }
    return mostFrequent || 'Nenhum';
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
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleAuthAction = async () => {
  setError('');
  setIsAuthLoading(true);
  try {
    let userCredential;
    if (isLogin) {
      userCredential = await signInWithEmailAndPassword(auth, email, password);
    } else {
      userCredential = await createUserWithEmailAndPassword(auth, email, password);
    }
    
    // Atualiza o perfil com o email (se logado com email/senha)
    if (userCredential?.user) {
      const user = userCredential.user;
      if (user.email) {
        console.log("Usuário logado com email:", user.email);
      }
    }
  } catch (err) {
    const msg = err.code.includes('auth/weak-password') ? 'Senha deve ter pelo menos 6 caracteres.' :
                  err.code.includes('auth/email-already-in-use') ? 'Este email já está em uso.' :
                  err.code.includes('auth/invalid-credential') ? 'Credenciais inválidas. Verifique seu email e senha.' :
                  'Erro de autenticação. Tente novamente.';
  } finally {
    setIsAuthLoading(false);
  }
};

  useEffect(() => {
  const performInitialAuth = async () => {
    try {
      // Prioriza autenticação anônima (mais rápida)
      await signInAnonymously(auth);
    } catch (e) {
      console.error("Erro na autenticação anônima:", e);
      // Fallback para custom token se necessário
      if (initialAuthToken) {
        try {
          await signInWithCustomToken(auth, initialAuthToken);
        } catch (tokenError) {
          console.error("Erro no token customizado:", tokenError);
        }
      }
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
          GOBRAINZY
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

// 2.5 Componente para Renderização Matemática (KaTeX)
const MathRenderer = ({ content }) => {
    const containerRef = React.useRef(null);

    // Renderiza KaTeX quando o conteúdo muda
    useEffect(() => {
        if (typeof window.katex === 'undefined') {
             // Fallback se KaTeX não estiver carregado
             containerRef.current.textContent = content;
             return;
        }

        if (!containerRef.current) return;

        containerRef.current.innerHTML = ''; // Limpa

        // Expressão para encontrar blocos $$...$$ (display) e $...$ (inline)
        const regex = /(\$\$[\s\S]*?\$\$|\$[^$]*?\$(?!\$))/g;
        let lastIndex = 0;
        
        // Percorre o conteúdo e substitui as fórmulas por KaTeX
        content.replace(regex, (match, formula, offset) => {
            // Adiciona o texto antes da fórmula
            const textBefore = content.substring(lastIndex, offset);
            if (textBefore) {
                const span = document.createElement('span');
                span.textContent = textBefore;
                containerRef.current.appendChild(span);
            }

            // Adiciona a fórmula KaTeX
            const displayMode = match.startsWith('$$');
            const formulaText = match.slice(displayMode ? 2 : 1, displayMode ? -2 : -1).trim();
            const formulaSpan = document.createElement('span');

            try {
                katex.render(formulaText, formulaSpan, {
                    throwOnError: false,
                    displayMode: displayMode,
                    output: 'html',
                    trust: true,
                });
            } catch (error) {
                // Se falhar, exibe o texto da fórmula como fallback
                formulaSpan.textContent = match;
            }
            containerRef.current.appendChild(formulaSpan);
            lastIndex = offset + match.length;
        });

        // Adiciona o texto após a última fórmula (ou todo o texto)
        const textAfter = content.substring(lastIndex);
        if (textAfter) {
            const span = document.createElement('span');
            span.textContent = textAfter;
            containerRef.current.appendChild(span);
        }

    }, [content]);

    return <p ref={containerRef} className="whitespace-pre-wrap text-gray-700 leading-relaxed"></p>;
};

// 2.6 Componente de Quiz Interativo (3 Perguntas)
// Recebe a mensagem e o índice para persistir o estado no Firestore
const InteractiveQuiz = ({ messageIndex, message, updateProfile, userProfile }) => {
    
    const quizzes = message.suggestions.quizzes;
    // LÊ o estado persistente do quiz ou inicializa se for a primeira vez
    const initialQuizStates = message.suggestions.quizStates || quizzes.map(() => ({ 
        selectedOption: null, 
        isAnswered: false,
        feedback: null,
    }));

    // Usamos o estado local apenas para reatividade IMEDIATA
    const [quizStates, setQuizStates] = useState(initialQuizStates);
    const [totalScore, setTotalScore] = useState(0);

    // Calcula a pontuação inicial a partir dos estados persistidos
    useEffect(() => {
        let initialScore = 0;
        initialQuizStates.forEach((state, index) => {
             if (state.isAnswered) {
                 const correctIndex = quizzes[index].correctOptionIndex;
                 const isCorrect = state.selectedOption === correctIndex;
                 initialScore += isCorrect ? POINTS_PER_CORRECT_ANSWER : POINTS_PER_WRONG_ANSWER;
             }
        });
        setTotalScore(initialScore);
    }, [quizzes, initialQuizStates]); // Recalcula se o estado inicial ou quizzes mudarem

    // Dentro do componente InteractiveQuiz
const handleAnswer = (quizIndex, selectedIndex, correctIndex) => {
    // Verifica se já foi respondido usando o estado local/persistente
    if (quizStates[quizIndex].isAnswered) return;

    const isCorrect = selectedIndex === correctIndex;
    
    // Calcula a mudança de pontuação usando as constantes definidas
    // POINTS_PER_CORRECT_ANSWER = 15; POINTS_PER_WRONG_ANSWER = -5;
    const scoreChange = isCorrect ? POINTS_PER_CORRECT_ANSWER : POINTS_PER_WRONG_ANSWER;
    
    const feedbackMessage = isCorrect 
        ? `Correto! Ganhou ${POINTS_PER_CORRECT_ANSWER} pontos.` 
        : `Errado. Perdeu ${Math.abs(POINTS_PER_WRONG_ANSWER)} pontos.`;
    
    // 1. Prepara o NOVO estado local e persistente (mantido)
    const newStates = [...quizStates];
    newStates[quizIndex] = {
        selectedOption: selectedIndex,
        isAnswered: true, 
        feedback: feedbackMessage,
    };
    
    // 2. Atualiza o estado local e pontuação total (mantido)
    setQuizStates(newStates);
    setTotalScore(prevScore => prevScore + scoreChange);
    
    // 3. Prepara a atualização do histórico (mantido)
    const updatedChatHistory = [...userProfile.chatHistory];
    
    // Atualiza a mensagem ESPECÍFICA no histórico
    updatedChatHistory[messageIndex] = {
        ...updatedChatHistory[messageIndex],
        suggestions: {
            ...updatedChatHistory[messageIndex].suggestions,
            quizStates: newStates // SALVA O NOVO ESTADO DO QUIZ
        }
    };

    // 4. Atualiza o perfil no Firestore (A CORREÇÃO ESTÁ AQUI)
    const updates = { 
        chatHistory: updatedChatHistory, // Salva o histórico (estado do quiz)
        points: increment(scoreChange) 
    };
    
    // Chama a função para persistir no Firebase
    updateProfile(updates);
};

    return (
        <div className="space-y-6 bg-yellow-50 p-5 rounded-xl border border-yellow-200 shadow-sm">
            <h4 className="font-bold text-lg text-yellow-800 flex items-center mb-4">
                <BookOpen className="w-5 h-5 mr-2" /> Mini-Game: Quiz (5 Perguntas)
            </h4>

            {quizzes.map((quiz, qIndex) => {
                // Lê o estado da pergunta atual, usando o estado local (que é sincronizado com o persistente)
                const state = quizStates[qIndex];
                const isAnswered = state.isAnswered;
                // Tenta pegar o índice. Se não existir, tenta achar o índice comparando o texto da opção com uma possível propriedade 'correctAnswer'
let correctIndex = quiz.correctOptionIndex;

if (correctIndex === undefined || correctIndex === null) {
    // Fallback: Se a IA mandou a resposta por extenso em 'correctAnswer' ou 'answer'
    const correctText = quiz.correctAnswer || quiz.answer;
    if (correctText) {
        correctIndex = quiz.options.findIndex(opt => opt.trim() === correctText.trim());
    }
}

// Se ainda assim falhar, assume 0 para não quebrar (ou trate como erro)
if (correctIndex === undefined || correctIndex === -1) correctIndex = 0;
                
                return (
                    <div key={qIndex} className="p-4 bg-white rounded-lg shadow-sm border border-gray-100">
                        <p className="font-medium mb-3 text-gray-800">
                            {qIndex + 1}. {quiz.question}
                        </p>
                        
                        <div className="space-y-2">
                            {quiz.options.map((option, index) => {
                                const isSelected = state.selectedOption === index;
                                const isCorrectOption = index === correctIndex;
                                
                                let optionClass = 'text-gray-600 border-gray-300 hover:bg-gray-50';
                                
                                if (isAnswered) {
                                    if (isCorrectOption) {
                                        optionClass = 'bg-green-100 text-green-800 border-green-400 font-semibold';
                                    } else if (isSelected) {
                                        optionClass = 'bg-red-100 text-red-800 border-red-400 line-through';
                                    } else {
                                        optionClass = 'text-gray-500 border-gray-200 cursor-not-allowed';
                                    }
                                } else {
                                    // Estado Interativo
                                    optionClass += ' hover:border-indigo-500 cursor-pointer';
                                }

                                return (
                                    <div 
                                        key={index}
                                        // Chama o handler APENAS se não foi respondido
                                        onClick={() => !isAnswered && handleAnswer(qIndex, index, correctIndex)}
                                        className={`flex items-start p-3 rounded-xl border transition-all duration-200 ${optionClass}`}
                                    >
                                        <span className={`flex-shrink-0 w-5 h-5 flex items-center justify-center mr-3 font-bold text-xs rounded-full 
                                            ${isAnswered && isCorrectOption ? 'bg-green-600' : 'bg-indigo-500'} text-white`}>
                                            {String.fromCharCode(65 + index)}
                                        </span>
                                        <span className="text-sm">{option}</span>
                                    </div>
                                );
                            })}
                        </div>
                        
                        {state.feedback && (
                            <div className={`mt-3 p-2 rounded-lg text-sm font-semibold ${
                                state.selectedOption === correctIndex ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                            }`}>
                                {state.feedback}
                            </div>
                        )}
                    </div>
                );
            })}
            
            <div className="pt-4 border-t border-yellow-300">
                 <p className="text-md font-bold text-yellow-800">
                    Pontuação Global Acumulada no Quiz: <span className="text-indigo-600">{totalScore}</span> pontos
                </p>
            </div>
        </div>
    );
};

const Flashcard = ({ question, answer }) => {
  const [flipped, setFlipped] = React.useState(false);

  return (
    <div
      onClick={() => setFlipped(!flipped)}
      className="bg-white border border-blue-300 rounded-xl shadow-sm p-4 cursor-pointer text-center transition-transform duration-300 hover:scale-105"
    >
      {!flipped ? (
        <p className="text-gray-800 font-medium">{question}</p>
      ) : (
        <p className="text-blue-700 font-semibold">{answer}</p>
      )}
    </div>
  );
};


// 2.7 Componente de Mensagem na Conversa
// Recebe messageIndex e userProfile para passar ao InteractiveQuiz
const ChatMessage = ({ message, messageIndex, updateProfile, userProfile, generateMentalMap }) => {
    const isUser = message.role === 'user';
    const suggestions = message.suggestions;
    
    // Verifica se ESTA mensagem específica está carregando o mapa
    const isMapLoading = message.isMapLoading || false;
    
    // 1. Renderização da Mensagem do Usuário
    if (isUser) {
        return (
            <div className="flex justify-end mb-4">
                <div className="bg-indigo-600 text-white p-4 rounded-t-xl rounded-bl-xl max-w-lg shadow-md">
                    <p className="font-semibold mb-1">Você:</p>
                    <p className="text-sm">{message.text}</p>
                </div>
            </div>
        );
    }
    
    // 2. Renderização da Mensagem da IA (Tutor)
    return (
        <div className="flex justify-start mb-8">
            <div className="bg-white p-6 rounded-t-xl rounded-br-xl max-w-3xl shadow-xl border border-gray-100 space-y-6 w-full">
                <p className="font-semibold text-indigo-700">Tutor IA:</p>
                
                {/* Renderização de Texto Matemático (KaTeX) */}
                <MathRenderer content={message.text} />
                
                {/* --- SEÇÃO DO QUIZ INTERATIVO --- */}
                {suggestions?.quizzes && suggestions.quizzes.length > 0 && (
                    <InteractiveQuiz 
                        message={message}
                        messageIndex={messageIndex}
                        updateProfile={updateProfile}
                        userProfile={userProfile}
                    />
                )}

                {/* --- SEÇÃO DE CONTEÚDO ADICIONAL (Vídeos/Jogos) --- */}
                {suggestions && (suggestions.videoData || suggestions.dragAndDropTopic) && (
                    <div className="space-y-4 pt-4 border-t border-gray-100">
                        <h4 className="font-bold text-lg text-indigo-700 flex items-center justify-center">
    <Brain className="w-5 h-5 mr-2" /> Próximos Passos de Aprendizado
</h4>

                        <div className="grid sm:grid-cols-2 gap-4">                           
                            
                            {/* Card: Drag and Drop Game (se houver) */}
                            {suggestions.dragAndDropTopic && (
                                <DragAndDropGame topic={suggestions.dragAndDropTopic} />
                            )}

                            {/* Card: Vídeo (Com Grounding do YouTube) */}
                            {suggestions.videoData ? (
                                <div className="bg-red-50 p-4 rounded-xl shadow-sm border border-red-200 col-span-2">
                                    <p className="font-semibold text-red-700 flex items-center mb-2">
                                        <Video className="w-4 h-4 mr-2" /> Sugestão de Vídeo
                                    </p>
                                    <div className="flex flex-col sm:flex-row gap-3 items-start">
                                        {suggestions.videoData.thumbnailUrl && (
                                            <div className="flex-shrink-0 w-full sm:w-1/4 aspect-video bg-gray-200 rounded-lg overflow-hidden">
                                                <img 
                                                    src={suggestions.videoData.thumbnailUrl} 
                                                    alt="Thumbnail do YouTube" 
                                                    className="w-full h-full object-cover"
                                                    onError={(e) => { 
                                                        e.target.onerror = null; 
                                                        e.target.src = 'https://s.ytimg.com/yts/img/favicon_144-vfliLAfaB.png'; 
                                                    }}
                                                />
                                            </div>
                                        )}
                                        <div className="flex-grow">
                                            <a 
                                                href={suggestions.videoData.uri} 
                                                target="_blank" 
                                                rel="noopener noreferrer" 
                                                className="text-sm font-bold text-red-800 hover:underline line-clamp-2"
                                            >
                                                {suggestions.videoData.title}
                                            </a>
                                            <p className="text-xs text-gray-600 mt-1">
                                                Canal: {suggestions.videoData.channel || 'YouTube'}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            ) : suggestions?.videoSubject && (
                                /* Fallback se não houver dados detalhados do vídeo */
                                <div className="bg-red-50 p-4 rounded-xl shadow-sm border border-red-200 col-span-2">
                                    <p className="font-semibold text-red-700 flex items-center mb-2">
                                        <Video className="w-4 h-4 mr-2" /> Pesquisar no YouTube
                                    </p>
                                    <a
                                        href={`https://www.youtube.com/results?search_query=${encodeURIComponent(suggestions.videoSubject)}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-base font-bold text-red-800 hover:underline"
                                    >
                                        Assistir vídeos sobre {suggestions.videoSubject}
                                    </a>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};


// 3. Componente de Chat e IA (Núcleo do App)
const AIChat = ({ userProfile, updateProfile }) => {
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [modalMessage, setModalMessage] = useState(null);
  const [localChatHistory, setLocalChatHistory] = useState([]);
  const [showMentalMap, setShowMentalMap] = useState(false);
  const [mentalMapTopics, setMentalMapTopics] = useState([]);
  const [isMindmapLoading, setIsMindmapLoading] = useState(false);
  const [isAIThinking, setIsAIThinking] = useState(false);


  const isPremium = userProfile?.isPremium || false;
  const isSearchAllowed = isPremium || userProfile?.searchCount < FREE_USER_LIMIT;
  const searchesLeft = isPremium ? 'Ilimitado' : FREE_USER_LIMIT - (userProfile?.searchCount || 0);

  // Função para gerar mapa mental
  // No componente AIChat, atualize a função generateMentalMap:
// Dentro do componente AIChat, substitua a função generateMentalMap por esta:

const generateMentalMap = async (topic, messageIndex) => {
  console.log("Iniciando geração de mapa mental para:", topic);
  
  // Define que ESTA mensagem específica está carregando o mapa
  setLocalChatHistory(prev => {
    const newHistory = [...prev];
    if(newHistory[messageIndex]) {
        newHistory[messageIndex].isMapLoading = true;
    }
    return newHistory;
  });

  try {
    // Prompt otimizado para a estrutura do seu componente MentalMap.jsx
    const prompt = `Crie um mapa mental sobre "${topic}". 
    Retorne APENAS um JSON válido seguindo estritamente esta estrutura recursiva para renderização:
    {
      "name": "${topic}",
      "children": [
        { "name": "Subtópico 1", "children": [ {"name": "Detalhe A"}, {"name": "Detalhe B"} ] },
        { "name": "Subtópico 2", "children": [...] }
      ]
    }
    Crie cerca de 3 ramos principais e 2-3 subníveis. Não use markdown, apenas o JSON raw.`;

    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
    };

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${API_KEY}`;
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    
    // Limpeza para garantir JSON válido (remove ```json e ```)
    const jsonString = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
    const mentalMapData = JSON.parse(jsonString);

    // 1. Atualiza o estado LOCAL para exibição imediata
    setLocalChatHistory(prev => {
      const newHistory = [...prev];
      if (newHistory[messageIndex]) {
          newHistory[messageIndex].isMapLoading = false;
          // Salva os dados do mapa DENTRO da mensagem
          newHistory[messageIndex].suggestions = {
            ...newHistory[messageIndex].suggestions,
            mentalMapData: mentalMapData 
          };
      }
      return newHistory;
    });

    // 2. Persistência no Firebase (para o mapa não sumir ao recarregar)
    const updatedHistory = [...chatHistory];
    if (updatedHistory[messageIndex]) {
        updatedHistory[messageIndex].suggestions = {
            ...updatedHistory[messageIndex].suggestions,
            mentalMapData: mentalMapData
        };
        
        // Atualiza a sessão atual
        const updatedSessions = userProfile.chatSessions.map(session => {
            if (session.id === userProfile.currentSessionId) {
                return { ...session, chatHistory: updatedHistory };
            }
            return session;
        });

        await updateProfile({ chatSessions: updatedSessions });
    }

  } catch (error) {
    console.error('Erro ao gerar mapa mental:', error);
    showModal('Erro', 'Não foi possível gerar o mapa mental.');
    
    // Remove o loading em caso de erro
    setLocalChatHistory(prev => {
        const newHistory = [...prev];
        if(newHistory[messageIndex]) newHistory[messageIndex].isMapLoading = false;
        return newHistory;
    });
  }
};

  // OTIMIZAÇÃO: Sincroniza o histórico local com o perfil do Firestore
  useEffect(() => {
    const currentSession = userProfile?.chatSessions?.find(
      session => session.id === userProfile.currentSessionId
    );

    if (currentSession?.chatHistory) {
      setLocalChatHistory(currentSession.chatHistory);
    }
  }, [userProfile]);

  // Obter sessão atual
  const currentSession = userProfile?.chatSessions?.find(
    session => session.id === userProfile.currentSessionId
  );
  const chatHistory = currentSession?.chatHistory || [];

  const showModal = (title, body) => {
    setModalMessage({ title, body });
    setTimeout(() => setModalMessage(null), 5000);
  };

  // Função para gerar título com IA
  const generateSessionTitle = async (firstQuestion) => {
    try {
      const prompt = `Com base na primeira pergunta do usuário abaixo, gere um título muito curto e descritivo (máximo 4-5 palavras) em português para esta conversa:

Pergunta: "${firstQuestion}"

Título:`;

      const payload = {
        contents: [{ parts: [{ text: prompt }] }],
      };

      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${API_KEY}`;

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      const title = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      
      return title.replace(/["']/g, '').replace(/^título:?\s*/i, '');
    } catch (error) {
      console.error("Erro ao gerar título:", error);
      return firstQuestion.split(' ').slice(0, 4).join(' ');
    }
  };

  /**
   * Busca um vídeo relevante no YouTube usando a ferramenta Google Search.
   */
  const findYoutubeVideo = async (subject) => {
    const youtubeQuery = `${subject} site:youtube.com`;

    const payload = {
      contents: [{ parts: [{ text: youtubeQuery }] }],
      tools: [{ "google_search": {} }],
      systemInstruction: { 
        parts: [{ text: "Encontre o primeiro resultado de vídeo no YouTube sobre o assunto fornecido. Retorne o link, título e canal." }] 
      },
    };

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${API_KEY}`;

    try {
      const apiResponse = await fetchWithRetry(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const groundingMetadata = apiResponse.candidates?.[0]?.groundingMetadata;

      if (groundingMetadata && groundingMetadata.groundingAttributions) {
        const firstYoutube = groundingMetadata.groundingAttributions.find(attr => 
          attr.web?.uri && attr.web.uri.includes('youtube.com/watch')
        );

        if (firstYoutube) {
          const uri = firstYoutube.web.uri;
          const title = firstYoutube.web.title || subject;
          const channel = firstYoutube.web.publisher || "YouTube";
          const videoIdMatch = uri.match(/(?<=v=)[^&]+/);
          const videoId = videoIdMatch ? videoIdMatch[0] : null;

          return {
            uri,
            title,
            channel,
            thumbnailUrl: videoId 
              ? `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`
              : 'https://placehold.co/1280x720/ef4444/ffffff?text=Video+Indisponível',
            videoSubject: subject,
          };
        }
      }

    } catch (error) {
      console.error("Erro ao buscar vídeo do YouTube:", error);
    }

    return {
      uri: `https://www.youtube.com/results?search_query=${encodeURIComponent(subject)}`,
      title: `Pesquise vídeos sobre ${subject}`,
      channel: "YouTube",
      thumbnailUrl: "https://s.ytimg.com/yts/img/favicon_144-vfliLAfaB.png",
      videoSubject: subject,
    };
  };

  /**
   * Função principal para a conversa com a IA.
   */
  const handleAISearch = async (e) => {
  e.preventDefault();
  if (!query || isLoading || !isSearchAllowed) return;

  const currentQuery = query.trim();
  setQuery('');
  setIsAIThinking(true);

  let newUserMessage;
  let updatedHistoryAfterUser;

  try {
    newUserMessage = {
      role: 'user',
      text: currentQuery,
      timestamp: new Date().toISOString()
    };

    setLocalChatHistory(prev => [...prev, newUserMessage]);
    updatedHistoryAfterUser = [...chatHistory, newUserMessage];

    let sessionTitle = currentSession?.title;
    if (chatHistory.length === 0) {
      sessionTitle = await generateSessionTitle(currentQuery);
    }

    const contextLimit = 4;
    const apiContext = updatedHistoryAfterUser
      .slice(-contextLimit)
      .map(msg => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.role === 'user' ? msg.text : msg.text + (msg.suggestions ? JSON.stringify(msg.suggestions) : '') }]
      }));

    const userQuery = `Pergunta do usuário: "${currentQuery}". Responda a pergunta. Em seguida, gere CINCO itens de QUIZ de múltipla escolha com 4 opções CADA, UM nome para a MATÉRIA PRINCIPAL, e UM assunto para VÍDEO CURTO, todos relacionados à resposta. O output deve ser APENAS um JSON válido.`;

    const systemInstruction = "Você é um Tutor de IA Educacional. Responda à pergunta do usuário. Sua resposta deve ser informativa, em Português do Brasil e, se houver fórmulas matemáticas, use a notação LaTeX ($...$ para inline, $$...$$ para display). Em seguida, gere um mini-game (5 quizzes) e sugestões de conteúdo adicional (matéria, vídeo) no formato JSON estrito para gamificar o aprendizado.";

    const payload = {
      contents: [
        ...apiContext,
        { parts: [{ text: userQuery }] }
      ],
      systemInstruction: { parts: [{ text: systemInstruction }] },
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            answer: { type: "STRING" },
            quizzes: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  question: { type: "STRING" },
                  options: {
                    type: "ARRAY",
                    items: { type: "STRING" }
                  },
                  correctOptionIndex: { type: "INTEGER" } // Força o índice numérico
                },
                required: ["question", "options", "correctOptionIndex"]
              }
            },
            learningSuggestions: {
              type: "OBJECT",
              properties: {
                subject: { type: "STRING" },
                videoSubject: { type: "STRING" },
                dragAndDropTopic: { type: "STRING" }
              }
            }
          }
        }
      }
    };

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${API_KEY}`;
    const apiResponse = await fetchWithRetry(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!apiResponse?.candidates?.length) {
      console.error("A resposta da IA veio vazia:", apiResponse);
      throw new Error("A IA não retornou nenhum texto. Verifique a chave de API ou o nome do modelo.");
    }

    const rawText = apiResponse.candidates[0]?.content?.parts?.[0]?.text?.trim();
    if (!rawText) {
      console.error("Resposta sem texto:", apiResponse);
      throw new Error("A IA não retornou texto útil.");
    }

    let parsedData;
    try {
      parsedData = JSON.parse(rawText);
    } catch (err) {
      console.error("Erro ao converter a resposta em JSON:", rawText);
      throw new Error("A resposta da IA não está no formato JSON esperado.");
    }

    const suggestions = parsedData.learningSuggestions;

    // grounding (optional)
    let videoData = null;
    try {
      if (suggestions?.videoSubject) {
        videoData = await findYoutubeVideo(suggestions.videoSubject);
      }
    } catch (videoErr) {
      console.warn("Erro ao buscar vídeo:", videoErr);
    }

    const finalSuggestions = {
      ...suggestions,
      videoData: videoData,
      quizzes: parsedData.quizzes,
    };

    // Build AI response
    const aiResponse = {
      role: 'model',
      text: parsedData.answer,
      suggestions: {
        ...finalSuggestions,
        quizStates: parsedData.quizzes.map(() => ({
          selectedOption: null,
          isAnswered: false,
          feedback: null,
        })),
      },
      timestamp: new Date().toISOString(),
    };

    // OPTIMISTIC UI: update local history with the final AI response
    setLocalChatHistory(prev => {
        // Remove the temporary user message added earlier if the API succeeded
        // This handles cases where user messages could be added twice if not careful
        const filtered = prev.filter(msg => msg.timestamp !== newUserMessage.timestamp || msg.role !== 'user');
        
        // Add both user and AI message back (if they weren't filtered out by the useEffect)
        return [...chatHistory, newUserMessage, aiResponse];
    });

    // prepare server-side persistence
    const updatedHistoryAfterAI = [...updatedHistoryAfterUser, aiResponse];

    const updatedSessions = userProfile.chatSessions.map(session => {
      if (session.id === userProfile.currentSessionId) {
        return {
          ...session,
          title: sessionTitle || session.title,
          chatHistory: updatedHistoryAfterAI,
          messageCount: updatedHistoryAfterAI.length,
          updatedAt: new Date().toISOString()
        };
      }
      return session;
    });

    const newSearchCount = userProfile.searchCount + 1;
    const newPoints = Math.max(0, userProfile.points + POINTS_PER_SEARCH_ACTIVITY);
    const searchTopic = finalSuggestions.subject || 'Geral';
    const newSearchTopics = [...(userProfile.searchTopics || []), searchTopic];

    const updates = {
      searchCount: newSearchCount,
      points: newPoints,
      chatSessions: updatedSessions,
      searchTopics: newSearchTopics,
    };

    // Persist but keep UI responsive; rollback if failure
    try {
      await updateProfile(updates);
      showModal('Sucesso!', `Você ganhou ${POINTS_PER_SEARCH_ACTIVITY} ponto pela atividade de pesquisa. Responda ao Quiz para ganhar mais!`);
    } catch (persistErr) {
      console.error('Erro ao salvar resposta no servidor:', persistErr);

      // rollback optimistic AI message and user message
      setLocalChatHistory(chatHistory); // Roll back to the state before the current interaction

      showModal('Erro na IA', 'Não foi possível salvar a resposta. Tente novamente.');
    } 

  } catch (err) {
    console.error('Erro inesperado no handleAISearch:', err);

    // Rollback: Reverte para o histórico anterior à falha
    setLocalChatHistory(chatHistory);

    showModal('Erro na IA', 'Não foi possível salvar a resposta. Tente novamente.');
    
} finally {
    // garante que SEMPRE desliga
    setIsAIThinking(false);
}
};


  // Efeito para rolar o chat para baixo
  useEffect(() => {
    const chatContainer = document.getElementById('chat-container');
    if (chatContainer) {
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }
  }, [localChatHistory.length]);

  return (
    <div className="p-4 sm:p-6 space-y-4 flex flex-col h-full">
      <h2 className="text-2xl font-bold text-gray-800 flex items-center flex-shrink-0">
        <MessageSquare className="w-6 h-6 mr-2 text-indigo-600" />
        Consultar IA
      </h2>

      {modalMessage && (
        <div className="fixed top-4 right-4 bg-green-100 text-green-800 p-4 rounded-xl shadow-lg z-50 transition-transform animate-slide-in">
          <p className="font-semibold">{modalMessage.title}</p>
          <p className="text-sm">{modalMessage.body}</p>
        </div>
      )}

      <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-xl text-sm font-medium flex-shrink-0">
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

      <div id="chat-container" className="flex-grow overflow-y-auto pr-2 custom-scrollbar pb-48">
        {chatHistory.length === 0 && !isLoading ? (
            <div className="text-center p-12 bg-gray-50 rounded-xl mt-6">
                <Search className="w-8 h-8 text-indigo-400 mx-auto mb-3" />
                <p className="text-gray-600 font-medium">Inicie sua conversa com o GOBRAINZY!</p>
                <p className="text-sm text-gray-400">Suas perguntas e as respostas da IA aparecerão aqui.</p>
            </div>
        ) : (
            localChatHistory.map((message, index) => (
      <ChatMessage 
        key={index} 
        message={message} 
        messageIndex={index}
        updateProfile={updateProfile}
        userProfile={userProfile}
        generateMentalMap={generateMentalMap} // ← CORRIGIDO: passe a função
        isLoading={isLoading} // ← CORRIGIDO: passe o estado de loading
              />
            ))
        )}
        {isAIThinking && (
            <div className="flex justify-start mb-4">
                <div className="bg-gray-200 text-gray-700 p-3 rounded-t-xl rounded-br-xl max-w-sm shadow-md flex items-center">
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    <p className="text-sm">IA está digitando...</p>
                </div>
            </div>
        )}
      </div>

      {/* Mapa Mental */}
      {showMentalMap && (
        <div className="mt-6">
          <MentalMap topics={mentalMapTopics} />
          <button
            onClick={() => setShowMentalMap(false)}
            className="mt-2 px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors"
          >
            Fechar Mapa Mental
          </button>
        </div>
      )}
      
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg p-4 z-30">
        <form onSubmit={handleAISearch} className="flex flex-col gap-3 max-w-4xl mx-auto">
          <textarea
            placeholder="Digite sua próxima dúvida sobre qualquer assunto..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            rows="2"
            className="w-full p-3 border border-gray-300 rounded-xl resize-none focus:ring-2 focus:ring-indigo-500 transition-shadow shadow-sm"
            disabled={isLoading || !isSearchAllowed}
          />
          <Button onClick={handleAISearch} disabled={isLoading || !isSearchAllowed || !query}>
            {isLoading ? <Loader2 className="w-6 h-6 animate-spin mx-auto" /> : 'Perguntar à IA'}
          </Button>
        </form>
      </div>
      
      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
            width: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
            background-color: #cbd5e1;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
            background: #f1f5f9;
        }
      `}</style>
    </div>
  );
};


// 4. Componente de Perfil e Gamificação (Atualizado com Estatísticas de Conversas)
const ProfileDisplay = ({ userProfile, userId, updateProfile }) => {
  const IconComponent = getIconComponent(userProfile?.avatarIcon || defaultAvatar.icon);
  const userColor = userProfile?.avatarColor || defaultAvatar.color;
  const userPoints = userProfile?.points || 0;
  const isPremium = userProfile?.isPremium || false;
  const chatSessions = userProfile?.chatSessions || [];
  const searchTopics = userProfile?.searchTopics || [];
  
  // Tópico mais pesquisado (Matéria)
  const mostFrequentTopic = findMostFrequentTopic(searchTopics);

  // Estatísticas das conversas
  const totalSessions = chatSessions.length;
  const totalMessages = chatSessions.reduce((total, session) => total + session.messageCount, 0);
  const activeSessions = chatSessions.filter(session => {
    const sessionDate = new Date(session.updatedAt);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return sessionDate > sevenDaysAgo;
  }).length;

  // Filtra as últimas 10 interações da sessão atual
  const currentSession = chatSessions.find(session => session.id === userProfile?.currentSessionId);
  const currentChatHistory = currentSession?.chatHistory || [];
  
  const conversationPairs = [];
  for (let i = currentChatHistory.length - 1; i >= 0; i--) {
      const message = currentChatHistory[i];
      if (message.role === 'model' && conversationPairs.length < 10) {
          // Acha a mensagem do usuário imediatamente anterior
          const userMessageIndex = i - 1;
          if (userMessageIndex >= 0 && currentChatHistory[userMessageIndex].role === 'user') {
              conversationPairs.unshift({
                  query: currentChatHistory[userMessageIndex].text,
                  answer: message.text,
                  timestamp: message.timestamp,
              });
          }
      }
  }

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

  return (
    <div className="p-4 sm:p-6 space-y-6 bg-white rounded-2xl shadow-xl">
      <h2 className="text-2xl font-bold text-gray-800 border-b pb-2 flex items-center">
        <User className="w-6 h-6 mr-2 text-indigo-600" />
        Meu Perfil de Estudante
      </h2>

      {/* Display do Avatar, Pontuação e ID */}
      <div className="flex flex-col sm:flex-row items-center gap-6 p-4 bg-indigo-50 border border-indigo-200 rounded-xl">
        <div className={`p-4 rounded-full shadow-lg ${isPremium ? 'border-4 border-yellow-400 bg-white' : 'bg-white'}`}>
          <IconComponent className={`w-12 h-12 text-${userColor}-500`} />
        </div>
        <div className="flex-grow">
          <p className="text-lg font-bold text-gray-800">ID do Usuário: {userId}</p>
          
          {/* Email do usuário */}
          {userProfile?.userEmail && (
            <p className="text-sm text-gray-600 mt-1">
              <span className="font-semibold">Email:</span> {userProfile.userEmail}
            </p>
          )}
          
          <div className="flex items-center text-xl font-extrabold text-indigo-600 mt-2">
            <Award className="w-6 h-6 mr-2 text-yellow-500" />
            {userPoints} Pontos
          </div>
          
          <p className="text-sm text-gray-500 mt-2">
             Status: {isPremium ? <span className="font-semibold text-yellow-600">Premium {PREMIUM_ICON}</span> : 'Gratuito'}
          </p>
        </div>
      </div>

      {/* Estatísticas das Conversas */}
      <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl shadow-md">
        <h3 className="font-bold text-lg text-blue-700 flex items-center mb-2">
          <MessageSquare className="w-5 h-5 mr-2" /> Estatísticas de Conversas
        </h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="text-center">
            <p className="text-2xl font-bold text-blue-600">{totalSessions}</p>
            <p className="text-gray-600">Conversas</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-green-600">{totalMessages}</p>
            <p className="text-gray-600">Mensagens</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-purple-600">{activeSessions}</p>
            <p className="text-gray-600">Ativas</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-orange-600">
              {totalSessions > 0 ? Math.round(totalMessages / totalSessions) : 0}
            </p>
            <p className="text-gray-600">Média/Conversa</p>
          </div>
        </div>
      </div>
      
      {/* Matéria Mais Pesquisada */}
      <div className="p-4 bg-purple-50 border border-purple-200 rounded-xl shadow-md">
          <h3 className="font-bold text-lg text-purple-700 flex items-center mb-2">
              <Hash className="w-5 h-5 mr-2" /> Matéria Mais Pesquisada
          </h3>
          <p className="text-xl font-extrabold text-gray-800">{mostFrequentTopic}</p>
          <p className="text-xs text-gray-600 mt-1">Baseado nos nomes de Matéria retornados pela IA.</p>
      </div>

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

      {/* Histórico das Últimas 10 Perguntas da Sessão Atual */}
      <div className="space-y-4 pt-4 border-t border-gray-100">
        <h3 className="text-xl font-bold text-gray-700 flex items-center">
            <Clock className="w-5 h-5 mr-2" /> Últimas Interações
        </h3>
        <div className="space-y-3 max-h-96 overflow-y-auto pr-2 custom-scrollbar">
            {conversationPairs.length === 0 ? (
                <div className="text-center text-gray-500 py-8">
                  <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Nenhuma interação encontrada na conversa atual.</p>
                  <p className="text-xs text-gray-400 mt-1">Comece uma conversa para ver seu histórico aqui.</p>
                </div>
            ) : (
                conversationPairs.map((pair, index) => (
                    <div key={index} className="bg-gray-50 p-3 rounded-xl border border-gray-200 shadow-sm">
                        <p className="text-xs text-indigo-600 font-bold mb-1">P: {pair.query}</p>
                        <p className="text-xs text-gray-700 line-clamp-2">R: {pair.answer}</p>
                        <p className="text-xs text-gray-400 mt-1 text-right">
                             {new Date(pair.timestamp).toLocaleDateString('pt-BR')}
                        </p>
                    </div>
                ))
            )}
        </div>
      </div>

      {/* Área Premium */}
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

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
            width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
            background-color: #cbd5e1;
            border-radius: 3px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
            background: #f1f5f9;
        }
      `}</style>
    </div>
  );
};

// 5. Partida Final (Simples) (Sem Alterações)
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

// Componente do Menu Lateral
const SidebarMenu = ({ 
  isOpen, 
  onClose, 
  activeTab, 
  setActiveTab, 
  userProfile, 
  updateProfile,
  setCurrentSessionId 
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  
  // Função para criar nova conversa
// Função para criar nova conversa
const createNewSession = async () => {
  const currentSession = userProfile?.chatSessions?.find(
    session => session.id === userProfile.currentSessionId
  );
  
  // Só cria nova conversa se a atual não estiver vazia
  const isCurrentSessionEmpty = !currentSession || 
                               currentSession.messageCount === 0 || 
                               currentSession.title === "Nova Conversa";
  
  if (isCurrentSessionEmpty) {
    // Se a sessão atual já está vazia, apenas navega para ela
    setActiveTab('chat');
    onClose();
    return;
  }
  
  // Cria nova sessão apenas se a atual tem conteúdo
  const newSessionId = `session_${Date.now()}`;
  const newSession = {
    id: newSessionId,
    title: "Nova Conversa",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messageCount: 0,
    chatHistory: [],
    tags: []
  };
  
  const updatedSessions = [...userProfile.chatSessions, newSession];
  
  await updateProfile({ 
    chatSessions: updatedSessions,
    currentSessionId: newSessionId 
  });
  
  setActiveTab('chat');
  onClose();
};
  
  // Função para selecionar uma conversa
  const selectSession = (sessionId) => {
    updateProfile({ currentSessionId: sessionId });
    setActiveTab('chat');
    onClose();
  };
  
  // Filtrar conversas baseado na busca
  const filteredSessions = userProfile?.chatSessions?.filter(session =>
    session.title.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];
  
  // Agrupar conversas por atividade (últimas 7 dias = Ativas, mais antigas = Histórico)
  const activeSessions = filteredSessions.filter(session => {
    const sessionDate = new Date(session.updatedAt);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return sessionDate > sevenDaysAgo;
  });
  
  const historySessions = filteredSessions.filter(session => {
    const sessionDate = new Date(session.updatedAt);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return sessionDate <= sevenDaysAgo;
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-40">
      {/* Fundo escurecido */}
      <div 
        className="absolute inset-0 bg-black/30 backdrop-blur-sm transition-opacity duration-300"
        onClick={onClose}
      ></div>

      {/* Menu lateral */}
      <aside 
        className="absolute left-0 top-0 bottom-0 w-80 bg-white shadow-2xl transform transition-transform duration-300 ease-out"
      >
        <div className="flex flex-col h-full">
          {/* Cabeçalho */}
          <div className="p-4 border-b border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <h1 className="text-xl font-extrabold text-indigo-700">GOBRAINZY</h1>
              <button
                onClick={onClose}
                className="p-1 rounded-md hover:bg-gray-100 transition-colors"
              >
                <svg className="w-5 h-5 text-gray-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            {/* Nova Conversa e Busca */}
            <div className="space-y-3">
              <button
                onClick={createNewSession}
                className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium"
              >
                <span>+</span>
                Nova Conversa
              </button>
              
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Buscar conversas..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>
            </div>
          </div>

          {/* Lista de Conversas */}
          <div className="flex-1 overflow-y-auto p-4 space-y-6">
            {/* Conversas Ativas */}
            {activeSessions.length > 0 && (
              <div>
                <h3 className="font-semibold text-gray-700 mb-3 flex items-center">
                  <span className="w-2 h-2 bg-green-500 rounded-full mr-2"></span>
                  Conversas Ativas
                </h3>
                <div className="space-y-2">
                  {activeSessions.map(session => (
                    <button
                      key={session.id}
                      onClick={() => selectSession(session.id)}
                      className={`w-full text-left p-3 rounded-lg transition-all ${
                        userProfile.currentSessionId === session.id 
                          ? 'bg-indigo-50 border border-indigo-200' 
                          : 'hover:bg-gray-50 border border-transparent'
                      }`}
                    >
                      <div className="font-medium text-gray-800 text-sm">
                        {session.title}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        {session.messageCount} mensagens • {new Date(session.updatedAt).toLocaleDateString('pt-BR')}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Histórico */}
            {historySessions.length > 0 && (
              <div>
                <h3 className="font-semibold text-gray-700 mb-3 flex items-center">
                  <Clock className="w-4 h-4 mr-2" />
                  Histórico
                </h3>
                <div className="space-y-2">
                  {historySessions.map(session => (
                    <button
                      key={session.id}
                      onClick={() => selectSession(session.id)}
                      className="w-full text-left p-3 rounded-lg hover:bg-gray-50 transition-colors border border-transparent"
                    >
                      <div className="font-medium text-gray-800 text-sm">
                        {session.title}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        {session.messageCount} mensagens • {new Date(session.updatedAt).toLocaleDateString('pt-BR')}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {filteredSessions.length === 0 && (
              <div className="text-center text-gray-500 py-8">
                <BookOpen className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p>Nenhuma conversa encontrada</p>
              </div>
            )}
          </div>

          {/* Rodapé do Menu */}
          <div className="p-4 border-t border-gray-200">
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => { setActiveTab('profile'); onClose(); }}
                className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg transition-colors ${
                  activeTab === 'profile' 
                    ? 'bg-indigo-100 text-indigo-700' 
                    : 'hover:bg-gray-100 text-gray-700'
                }`}
              >
                <User className="w-4 h-4" />
                Perfil
              </button>
              <button
                onClick={() => { setActiveTab('match'); onClose(); }}
                className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg transition-colors ${
                  activeTab === 'match' 
                    ? 'bg-green-100 text-green-700' 
                    : 'hover:bg-gray-100 text-gray-700'
                }`}
              >
                <Zap className="w-4 h-4" />
                Revisão
              </button>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
};

// 6. Componente Principal do App (Após Login) (Ajustado para KaTeX e Layout Fixo)
const MainAppScreen = ({ auth, db, userId, userProfile, updateProfile }) => {
  const [activeTab, setActiveTab] = useState('chat'); // Padrão agora é 'chat'
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // Carrega KaTeX (CSS e JS) globalmente para renderização matemática
  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.css';
    link.crossOrigin = 'anonymous';
    document.head.appendChild(link);

    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.js';
    script.crossOrigin = 'anonymous';
    document.head.appendChild(script);

    return () => {
        // Limpeza (pode não ser necessário, mas é boa prática)
        document.head.removeChild(link);
        document.head.removeChild(script);
    };
  }, []);

  const navItems = [
    { id: 'profile', label: 'Perfil', icon: User, component: ProfileDisplay },
    { id: 'match', label: 'Revisão', icon: Zap, component: FinalMatch },
    { id: 'chat', label: 'Chat', icon: MessageSquare, component: AIChat },
  ];

  const ActiveComponent = navItems.find(item => item.id === activeTab)?.component || AIChat;

  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch (e) {
      console.error("Erro ao sair:", e);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-gray-100 overflow-hidden">
      {/* Header Fixo */}
      <header
  className="shadow-md p-4 flex items-center justify-between sticky top-0 z-30"
  style={{ backgroundColor: "#fad45c" }}
>
  <div className="flex items-center">
    <button
      onClick={() => setIsSidebarOpen(true)}
      className="mr-3 p-2 rounded-md hover:bg-yellow-300 transition-colors"
      aria-label="Abrir menu"
    >
      <svg className="w-6 h-6 text-black" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    </button>

    {/* LOGO ADICIONADA AQUI */}
    <img
      src="/LOGO-GB-VETOR.svg"           
      alt="Logo-gb"
      className="h-10 w-auto mr-3"
    />

    <h1 className="text-xl font-extrabold text-black">GOBRAINZY</h1>
  </div>

  <button
    onClick={handleSignOut}
    className="text-black hover:text-red-600 transition-colors flex items-center text-sm"
  >
    <LogOut className="w-5 h-5 mr-1" /> Sair
  </button>
</header>


      {/* Menu Lateral */}
      <SidebarMenu
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        userProfile={userProfile}
        updateProfile={updateProfile}
      />

      {/* Conteúdo Principal */}
      <main className="flex-grow p-4 sm:p-8 overflow-y-auto pb-24 sm:pb-8">
        <div className="max-w-4xl mx-auto">
          <ActiveComponent 
            userProfile={userProfile} 
            userId={userId} 
            updateProfile={updateProfile} 
          />
        </div>
      </main>

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


// 7. Componente Raiz (Gerencia Firebase e Estado Global)
const App = () => {
  const [app, setApp] = useState(null);
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [user, setUser] = useState(null); // Objeto de usuário do Firebase Auth
  const [userId, setUserId] = useState(null); // ID do usuário ou anônimo
  const [userProfile, setUserProfile] = useState(null); // Perfil do Firestore
  const [authReady, setAuthReady] = useState(false);
  const [isProfileLoading, setIsProfileLoading] = useState(true);

  // 7.1. Inicialização do Firebase e Autenticação
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

  // 7.2. Lógica de Perfil (Firestore)
  useEffect(() => {
  if (db && userId) {
    setIsProfileLoading(true);
    const profilePath = `/artifacts/${appId}/users/${userId}/data/userProfile`;
    const profileRef = doc(db, profilePath);

    // Timeout para evitar loading infinito
    const timeoutId = setTimeout(() => {
      console.log("Timeout no carregamento do perfil");
      setIsProfileLoading(false);
    }, 8000); // 8 segundos máximo

    const unsubscribeProfile = onSnapshot(profileRef, 
      (docSnapshot) => {
        clearTimeout(timeoutId); // Limpa o timeout se carregou
        
        if (docSnapshot.exists()) {
          setUserProfile(docSnapshot.data());
        } else {
          // Cria perfil inicial apenas quando necessário
          const initialProfile = {
  points: 0,
  searchCount: 0,
  isPremium: false,
  avatarIcon: defaultAvatar.icon,
  avatarColor: defaultAvatar.color,
  createdAt: new Date().toISOString(),
  userId: userId,
  userEmail: user?.email || null,
  // NOVA ESTRUTURA DE SESSÕES
  chatSessions: [
    {
      id: `session_${Date.now()}`,
      title: "Nova Conversa",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messageCount: 0,
      chatHistory: [],
      tags: []
    }
  ],
  currentSessionId: `session_${Date.now()}`
};
          
          // Não espera pela criação - atualiza estado local imediatamente
          setUserProfile(initialProfile);
          setDoc(profileRef, initialProfile, { merge: true })
            .catch(error => console.error("Erro ao criar perfil:", error));
        }
        setIsProfileLoading(false);
      },
      (error) => {
        clearTimeout(timeoutId);
        console.error("Erro ao carregar perfil:", error);
        setIsProfileLoading(false);
      }
    );

    return () => {
      clearTimeout(timeoutId);
      unsubscribeProfile();
    };
  }
}, [db, userId]);

  // Função para atualizar o perfil no Firestore

const updateProfile = useCallback(async (updates) => {
  if (!db || !userId) return;
  const profilePath = `/artifacts/${appId}/users/${userId}/data/userProfile`;
  const profileRef = doc(db, profilePath);
  
  try {
    // Para campos numéricos que precisam de incremento, usar FieldValue.increment
    await updateDoc(profileRef, updates);
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
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <Loader2 className="w-12 h-12 animate-spin text-indigo-600 mx-auto mb-4" />
        <p className="text-lg font-medium text-gray-700">Carregando seu perfil...</p>
        <p className="text-sm text-gray-500 mt-2">Isso pode levar alguns segundos</p>
      </div>
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