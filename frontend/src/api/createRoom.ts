import { ref, push, update } from "firebase/database";
import { db } from "../lib/firebase";
import type { Room, Player, DifficultyLevel } from "../../../shared/types";
import { getSampleQuestions } from "../utils/sampleQuiz";
import { generateQuestions, validateTopic } from "../services/questionGeneration";

// New imports for hybrid functionality
import { MIGRATION_FLAGS } from "../config/environment";
import { createRoom as createRoomBackend, isBackendHealthy } from "../services/apiClient";

export async function createRoom(
  nickname: string,
  topic: string,
  difficulty: DifficultyLevel,
  questionCount: number
): Promise<{roomId: string, playerId: string, aiGenerated: boolean, fallbackReason?: string}> {
  
  // Dynamic feature flag check - check current flag value at runtime
  const useBackend = MIGRATION_FLAGS.USE_BACKEND_FOR_ROOM_CREATION && 
                    !MIGRATION_FLAGS.FORCE_FIREBASE_FALLBACK && 
                    !MIGRATION_FLAGS.DISABLE_BACKEND_COMPLETELY;

  // Feature flag check - try backend first if enabled
  if (useBackend) {
    try {
      console.log('🔄 Attempting room creation via backend...');
      
      // Check backend health before attempting
      if (!isBackendHealthy()) {
        console.warn('⚠️ Backend not healthy, falling back to Firebase');
        return await createRoomFirebase(nickname, topic, difficulty, questionCount);
      }
      
      // Try backend room creation
      const result = await createRoomBackend({
        nickname: nickname.trim(),
        topic: topic.trim(),
        difficulty,
        questionCount
      });
      
      console.log('✅ Room created successfully via backend:', result.roomId);
      
      // Store player ID in localStorage for consistency with Firebase approach
      localStorage.setItem("userId", result.playerId);
      
      return result;
      
    } catch (error: any) {
      console.warn('🔄 Backend room creation failed, falling back to Firebase:', error.message);
      
      // Automatic fallback to Firebase on any backend error
      return await createRoomFirebase(nickname, topic, difficulty, questionCount);
    }
  }
  
  // Default: Use Firebase (original implementation)
  console.log('🔥 Creating room via Firebase (default)');
  return await createRoomFirebase(nickname, topic, difficulty, questionCount);
}

// Original Firebase implementation (unchanged, moved to separate function)
async function createRoomFirebase(
  nickname: string,
  topic: string,
  difficulty: DifficultyLevel,
  questionCount: number
): Promise<{roomId: string, playerId: string, aiGenerated: boolean, fallbackReason?: string}> {
  
  // Validate inputs
  if (!nickname.trim()) {
    throw new Error('Nickname is required');
  }
  
  if (!topic.trim()) {
    throw new Error('Topic is required');
  }
  
  // Validate topic appropriateness
  const topicValidation = validateTopic(topic);
  if (!topicValidation.valid) {
    throw new Error(topicValidation.suggestion || 'Invalid topic');
  }
  
  if (questionCount < 1 || questionCount > 35) {
    throw new Error('Question count must be between 1 and 35');
  }

  const roomCode = Math.floor(100000 + Math.random() * 900000).toString(); 
  const hostId = `host_${Date.now()}`;

  // Try AI question generation first, fallback to sample questions
  let questions;
  let aiGenerated = false;
  let fallbackReason: string | undefined;

  try {
    console.log(`🤖 Generating ${questionCount} ${difficulty} questions about "${topic}"`);
    questions = await generateQuestions({
      topic: topic.trim(),
      difficulty,
      count: questionCount
    });
    aiGenerated = true;
    console.log(`✅ Successfully generated ${questions.length} AI questions`);
  } catch (error) {
    console.warn('🔄 AI generation failed, using sample questions:', error);
    questions = getSampleQuestions(difficulty).slice(0, questionCount);
    aiGenerated = false;
    
    // Determine fallback reason for user feedback
    if (error instanceof Error) {
      if (error.message.includes('API key')) {
        fallbackReason = 'OpenAI API key not configured';
      } else if (error.message.includes('rate limit')) {
        fallbackReason = 'API rate limit reached';
      } else if (error.message.includes('network') || error.message.includes('fetch')) {
        fallbackReason = 'Network connection issue';
      } else {
        fallbackReason = 'AI service temporarily unavailable';
      }
    } else {
      fallbackReason = 'AI service temporarily unavailable';
    }
  }

  // Ensure we have enough questions
  if (questions.length < questionCount) {
    // Repeat questions if we don't have enough
    const originalQuestions = [...questions];
    while (questions.length < questionCount) {
      questions.push(...originalQuestions.slice(0, questionCount - questions.length));
    }
  }

  const hostPlayer: Player = {
    id: hostId,
    nickname: nickname.trim(),
    isHost: true,
    score: 0,
    joinedAt: Date.now(),
    answers: {},
  };

  const roomData: Omit<Room, "id"> = {
    roomCode,
    topic: topic.trim(),
    difficulty,
    questionCount,
    status: "waiting",
    hostId,
    createdAt: Date.now(),
    currentQuestionIndex: 0,
    players: { [hostId]: hostPlayer },
    questions: questions.slice(0, questionCount), // Ensure exact count
    totalQuestions: questionCount,
    isGameComplete: false,
  };

  const roomRef = push(ref(db, "rooms"));
  const roomId = roomRef.key!;
  await update(roomRef, { ...roomData, id: roomId });

  // Store player ID in localStorage
  localStorage.setItem("userId", hostId);

  console.log(`🎉 Room created successfully via Firebase: ${roomCode} (${questions.length} questions, AI: ${aiGenerated})`);

  return {
    roomId, 
    playerId: hostId, 
    aiGenerated, 
    fallbackReason
  };
}

// Export Firebase implementation for testing/debugging
export { createRoomFirebase };

// Function to create room with pre-generated questions (for document-based quizzes)
export async function createRoomWithQuestions(
  nickname: string,
  topic: string,
  difficulty: DifficultyLevel,
  questionCount: number,
  questions: any[]
): Promise<{roomId: string, playerId: string, aiGenerated: boolean, fallbackReason?: string}> {
  
  // Dynamic feature flag check - check current flag value at runtime
  const useBackend = MIGRATION_FLAGS.USE_BACKEND_FOR_ROOM_CREATION && 
                    !MIGRATION_FLAGS.FORCE_FIREBASE_FALLBACK && 
                    !MIGRATION_FLAGS.DISABLE_BACKEND_COMPLETELY;

  // Feature flag check - try backend first if enabled
  if (useBackend) {
    try {
      console.log('🔄 Attempting room creation with pre-generated questions via backend...');
      
      // Check backend health before attempting
      if (!isBackendHealthy()) {
        console.warn('⚠️ Backend not healthy, falling back to Firebase');
        return await createRoomFirebaseWithQuestions(nickname, topic, difficulty, questionCount, questions);
      }
      
      // Try backend room creation with pre-generated questions
      const result = await createRoomBackend({
        nickname: nickname.trim(),
        topic: topic.trim(),
        difficulty,
        questionCount,
        questions // Pass the pre-generated questions
      });
      
      console.log('✅ Room created successfully with pre-generated questions via backend:', result.roomId);
      
      // Store player ID in localStorage for consistency with Firebase approach
      localStorage.setItem("userId", result.playerId);
      
      return result;
      
    } catch (error: any) {
      console.warn('🔄 Backend room creation with pre-generated questions failed, falling back to Firebase:', error.message);
      
      // Automatic fallback to Firebase on any backend error
      return await createRoomFirebaseWithQuestions(nickname, topic, difficulty, questionCount, questions);
    }
  }
  
  // Default: Use Firebase (original implementation)
  console.log('🔥 Creating room with pre-generated questions via Firebase (default)');
  return await createRoomFirebaseWithQuestions(nickname, topic, difficulty, questionCount, questions);
}

// Firebase implementation for creating room with pre-generated questions
async function createRoomFirebaseWithQuestions(
  nickname: string,
  topic: string,
  difficulty: DifficultyLevel,
  questionCount: number,
  questions: any[]
): Promise<{roomId: string, playerId: string, aiGenerated: boolean, fallbackReason?: string}> {
  
  // Validate inputs
  if (!nickname.trim()) {
    throw new Error('Nickname is required');
  }
  
  if (!topic.trim()) {
    throw new Error('Topic is required');
  }
  
  if (questionCount < 1 || questionCount > 35) {
    throw new Error('Question count must be between 1 and 35');
  }

  if (!questions || questions.length !== questionCount) {
    throw new Error(`Expected ${questionCount} questions, but received ${questions?.length || 0}`);
  }

  const roomCode = Math.floor(100000 + Math.random() * 900000).toString(); 
  const hostId = `host_${Date.now()}`;

  // Create room with pre-generated questions
  const roomRef = push(ref(db, "rooms"));
  const roomId = roomRef.key!;

  const hostPlayer: Player = {
    id: hostId,
    nickname: nickname.trim(),
    isHost: true,
    score: 0,
    joinedAt: Date.now(),
    answers: {}
  };

  const roomData: Room = {
    id: roomId,
    roomCode,
    topic: topic.trim(),
    difficulty,
    questionCount,
    status: "waiting",
    hostId,
    createdAt: Date.now(),
    currentQuestionIndex: 0,
    players: {
      [hostId]: hostPlayer
    },
    questions: questions,
    totalQuestions: questionCount,
    isGameComplete: false,
    aiGenerated: true, // Pre-generated questions are considered AI-generated
    questionsGenerating: false // Questions are already available
  };

  await update(ref(db, `rooms/${roomId}`), roomData);

  console.log(`✅ Room ${roomCode} created with ${questions.length} pre-generated questions`);

  return {
    roomId,
    playerId: hostId,
    aiGenerated: true,
    fallbackReason: undefined
  };
}