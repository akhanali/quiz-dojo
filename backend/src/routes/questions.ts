import { Router, Request, Response } from 'express';
import { 
  isOpenAIAvailable, 
  getOpenAIClient, 
  generateQuestionPrompt, 
  validateOpenAIResponse,
  OPENAI_CONFIG 
} from '../config/openai';
import { 
  QuestionGenerationParams, 
  QuestionGenerationResponse, 
  Question,
  DifficultyLevel,
  ErrorResponse 
} from '../types/types';

const router = Router();

/**
 * Sample fallback questions organized by difficulty
 */
const getSampleQuestions = (difficulty: DifficultyLevel): Question[] => {
  const questions = {
    easy: [
      {
        text: "What is the capital of France?",
        options: ["London", "Berlin", "Paris", "Madrid"],
        correctOption: "Paris",
        timeLimit: 15,
        difficulty: "easy" as DifficultyLevel
      },
      {
        text: "Which planet is closest to the Sun?",
        options: ["Venus", "Mercury", "Earth", "Mars"],
        correctOption: "Mercury",
        timeLimit: 12,
        difficulty: "easy" as DifficultyLevel
      },
      {
        text: "What color do you get when you mix red and white?",
        options: ["Purple", "Orange", "Pink", "Yellow"],
        correctOption: "Pink",
        timeLimit: 10,
        difficulty: "easy" as DifficultyLevel
      },
      {
        text: "How many sides does a triangle have?",
        options: ["2", "3", "4", "5"],
        correctOption: "3",
        timeLimit: 8,
        difficulty: "easy" as DifficultyLevel
      },
      {
        text: "Which animal is known as the 'King of the Jungle'?",
        options: ["Tiger", "Elephant", "Lion", "Bear"],
        correctOption: "Lion",
        timeLimit: 12,
        difficulty: "easy" as DifficultyLevel
      }
    ],
    medium: [
      {
        text: "What is the chemical symbol for gold?",
        options: ["Go", "Gd", "Au", "Ag"],
        correctOption: "Au",
        timeLimit: 20,
        difficulty: "medium" as DifficultyLevel
      },
      {
        text: "In which year did World War II end?",
        options: ["1944", "1945", "1946", "1947"],
        correctOption: "1945",
        timeLimit: 25,
        difficulty: "medium" as DifficultyLevel
      },
      {
        text: "What is the largest mammal in the world?",
        options: ["African Elephant", "Blue Whale", "Giraffe", "Hippopotamus"],
        correctOption: "Blue Whale",
        timeLimit: 18,
        difficulty: "medium" as DifficultyLevel
      },
      {
        text: "Which programming language is known for its use in data science?",
        options: ["JavaScript", "Python", "C++", "PHP"],
        correctOption: "Python",
        timeLimit: 22,
        difficulty: "medium" as DifficultyLevel
      },
      {
        text: "What is the square root of 144?",
        options: ["10", "11", "12", "13"],
        correctOption: "12",
        timeLimit: 15,
        difficulty: "medium" as DifficultyLevel
      }
    ],
    hard: [
      {
        text: "What is the time complexity of binary search?",
        options: ["O(n)", "O(log n)", "O(n log n)", "O(n²)"],
        correctOption: "O(log n)",
        timeLimit: 35,
        difficulty: "hard" as DifficultyLevel
      },
      {
        text: "Which of the following is NOT a principle of object-oriented programming?",
        options: ["Encapsulation", "Inheritance", "Polymorphism", "Compilation"],
        correctOption: "Compilation",
        timeLimit: 30,
        difficulty: "hard" as DifficultyLevel
      },
      {
        text: "In quantum mechanics, what does Schrödinger's equation describe?",
        options: ["Wave function evolution", "Particle position", "Energy levels", "Spin states"],
        correctOption: "Wave function evolution",
        timeLimit: 40,
        difficulty: "hard" as DifficultyLevel
      },
      {
        text: "What is the primary cause of ocean acidification?",
        options: ["Industrial pollution", "CO2 absorption", "Temperature rise", "Overfishing"],
        correctOption: "CO2 absorption",
        timeLimit: 35,
        difficulty: "hard" as DifficultyLevel
      },
      {
        text: "Which algorithm is commonly used for finding shortest paths in graphs?",
        options: ["Bubble Sort", "Dijkstra's Algorithm", "Quick Sort", "Binary Search"],
        correctOption: "Dijkstra's Algorithm",
        timeLimit: 30,
        difficulty: "hard" as DifficultyLevel
      }
    ]
  };

  return questions[difficulty] || questions.easy;
};

/**
 * Validate question generation request
 */
const validateQuestionRequest = (body: any): { valid: boolean; errors: string[] } => {
  const errors: string[] = [];

  if (!body.topic || typeof body.topic !== 'string' || body.topic.trim().length === 0) {
    errors.push('Topic is required and must be a non-empty string');
  }
  if (body.topic && body.topic.trim().length > 100) {
    errors.push('Topic must be 100 characters or less');
  }

  if (!body.difficulty || !['easy', 'medium', 'hard'].includes(body.difficulty)) {
    errors.push('Difficulty must be one of: easy, medium, hard');
  }

  if (!body.count || typeof body.count !== 'number') {
    errors.push('Count must be a number');
  }
  if (body.count && (body.count < 1 || body.count > 35)) {
    errors.push('Count must be between 1 and 35');
  }

  return { valid: errors.length === 0, errors };
};

/**
 * Validate and enhance generated questions
 */
const validateAndEnhanceQuestions = (
  questions: any[], 
  params: QuestionGenerationParams
): Question[] => {
  const validQuestions: Question[] = [];
  let totalProcessed = 0;
  let validationFailures = 0;

  console.log(`🔍 Validating ${questions.length} AI-generated questions...`);

  for (const q of questions) {
    totalProcessed++;
    try {
      // Validate basic structure
      if (!q.text || !Array.isArray(q.options) || !q.correctOption) {
        console.warn(`⚠️ Question ${totalProcessed} failed: Missing required fields`, {
          hasText: !!q.text,
          hasOptions: Array.isArray(q.options),
          hasCorrectOption: !!q.correctOption,
          question: q
        });
        validationFailures++;
        continue;
      }

      // Clean and validate text
      const cleanText = q.text.trim();
      if (!cleanText || cleanText.length < 10) {
        console.warn(`⚠️ Question ${totalProcessed} failed: Text too short or empty`, {
          text: cleanText,
          length: cleanText.length
        });
        validationFailures++;
        continue;
      }

      // Validate options array
      if (!Array.isArray(q.options) || q.options.length !== 4) {
        console.warn(`⚠️ Question ${totalProcessed} failed: Incorrect number of options (${q.options?.length || 0}, expected 4)`, {
          question: cleanText,
          optionsCount: q.options?.length || 0,
          options: q.options
        });
        validationFailures++;
        continue;
      }

      // Clean and validate options
      const cleanOptions = q.options.map((opt: any) => {
        if (typeof opt !== 'string') {
          return String(opt).trim();
        }
        return opt.trim();
      }).filter((opt: string) => opt.length > 0);

      if (cleanOptions.length !== 4) {
        console.warn(`⚠️ Question ${totalProcessed} failed: Invalid options after cleaning`, {
          question: cleanText,
          originalOptions: q.options,
          cleanOptions: cleanOptions
        });
        validationFailures++;
        continue;
      }

      // Validate correct option exists in options array
      const correctOptionText = q.correctOption.trim();
      const optionTexts = cleanOptions;
      
      if (!optionTexts.includes(correctOptionText)) {
        // Try case-insensitive matching
        const lowerCorrect = correctOptionText.toLowerCase();
        const lowerOptions = optionTexts.map((opt: string) => opt.toLowerCase());
        const matchIndex = lowerOptions.findIndex((opt: string) => opt === lowerCorrect);
        
        if (matchIndex !== -1) {
          console.warn(`⚠️ Question ${totalProcessed}: Fixed case mismatch in correct option:`, correctOptionText, '→', optionTexts[matchIndex]);
          q.correctOption = optionTexts[matchIndex];
        } else {
          // Try partial matching for common AI mistakes
          const partialMatch = optionTexts.find((opt: string) => 
            opt.toLowerCase().includes(correctOptionText.toLowerCase()) ||
            correctOptionText.toLowerCase().includes(opt.toLowerCase())
          );
          
          if (partialMatch) {
            console.warn(`⚠️ Question ${totalProcessed}: Fixed partial match in correct option:`, correctOptionText, '→', partialMatch);
            q.correctOption = partialMatch;
          } else {
            console.warn(`⚠️ Question ${totalProcessed} failed: Correct option not found in options`, {
              question: cleanText,
              correctOption: correctOptionText,
              availableOptions: optionTexts
            });
            validationFailures++;
          continue;
          }
        }
      }

      // Set appropriate time limit based on difficulty if not provided
      let timeLimit = q.timeLimit;
      if (!timeLimit || typeof timeLimit !== 'number' || timeLimit < 5 || timeLimit > 60) {
        switch (params.difficulty) {
          case 'easy':
            timeLimit = 15;
            break;
          case 'medium':
            timeLimit = 25;
            break;
          case 'hard':
            timeLimit = 35;
            break;
          default:
            timeLimit = 20;
        }
      }

      // Create validated question
      const validQuestion: Question = {
        text: cleanText,
        options: optionTexts,
        correctOption: q.correctOption.trim(),
        timeLimit,
        difficulty: params.difficulty
      };

      validQuestions.push(validQuestion);

    } catch (error) {
      console.warn(`⚠️ Question ${totalProcessed} failed: Error during validation:`, error, q);
      validationFailures++;
    }
  }

  console.log(`✅ Validation complete: ${validQuestions.length}/${totalProcessed} questions passed validation (${validationFailures} failures)`);
  
  if (validationFailures > 0) {
    console.log(`📊 Validation Summary:`);
    console.log(`   - Total questions processed: ${totalProcessed}`);
    console.log(`   - Valid questions: ${validQuestions.length}`);
    console.log(`   - Failed questions: ${validationFailures}`);
    console.log(`   - Success rate: ${((validQuestions.length / totalProcessed) * 100).toFixed(1)}%`);
  }

  return validQuestions;
};

/**
 * Generate questions using AI or fallback to samples
 */
const generateQuestions = async (params: QuestionGenerationParams): Promise<QuestionGenerationResponse> => {
  console.log(`🤖 Generating ${params.count} ${params.difficulty} questions about "${params.topic}"`);

  // Check if OpenAI is available
  if (!isOpenAIAvailable()) {
    console.log('⚠️ OpenAI not available, using sample questions');
    const sampleQuestions = getSampleQuestions(params.difficulty);
    const selectedQuestions = sampleQuestions.slice(0, params.count);
    
    // Pad with repeated questions if needed
    while (selectedQuestions.length < params.count) {
      const remaining = params.count - selectedQuestions.length;
      const additionalQuestions = sampleQuestions.slice(0, remaining);
      selectedQuestions.push(...additionalQuestions);
    }

    return {
      questions: selectedQuestions.slice(0, params.count),
      aiGenerated: false,
      fallbackReason: 'OpenAI API not configured'
    };
  }

  try {
    const openai = getOpenAIClient()!;
    
    // Request extra questions to account for potential validation losses
    const requestedCount = params.count;
    const bufferCount = Math.ceil(requestedCount * 1.1); // Request 10% more (reduced from 20%)
    
    console.log(`🧠 Requesting ${bufferCount} questions from AI (target: ${requestedCount}, buffer: ${bufferCount - requestedCount})`);
    
    const prompt = generateQuestionPrompt(params.topic, params.difficulty, bufferCount);

    console.log('🧠 Sending request to OpenAI...');
    const response = await openai.chat.completions.create({
      model: OPENAI_CONFIG.model,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: OPENAI_CONFIG.max_tokens,
      temperature: OPENAI_CONFIG.temperature,
    });

    // Validate OpenAI response
    const validation = validateOpenAIResponse(response);
    if (!validation.valid) {
      throw new Error(`OpenAI response validation failed: ${validation.error}`);
    }

    const content = response.choices[0].message.content!;
    console.log('📝 Raw OpenAI response length:', content.length);

    // Parse JSON response
    let parsedQuestions;
    try {
      // Clean content (remove any markdown formatting or extra text)
      const cleanContent = content.replace(/```json\s*|\s*```/g, '').trim();
      parsedQuestions = JSON.parse(cleanContent);
    } catch (parseError) {
      console.error('❌ Failed to parse OpenAI JSON response:', parseError);
      console.error('Response content:', content);
      throw new Error('Invalid JSON format in OpenAI response');
    }

    // Validate and enhance questions
    const validQuestions = validateAndEnhanceQuestions(parsedQuestions, params);

    if (validQuestions.length === 0) {
      throw new Error('No valid questions generated by OpenAI');
    }

    // If we don't have enough valid questions, pad with samples
    if (validQuestions.length < requestedCount) {
      console.warn(`⚠️ Only ${validQuestions.length} valid questions generated, needed ${requestedCount}`);
      const sampleQuestions = getSampleQuestions(params.difficulty);
      const needed = requestedCount - validQuestions.length;
      validQuestions.push(...sampleQuestions.slice(0, needed));
    }

    console.log(`✅ Successfully generated ${validQuestions.length} questions using OpenAI (${validQuestions.length >= requestedCount ? '100% AI' : 'mixed AI + samples'})`);

    return {
      questions: validQuestions.slice(0, requestedCount),
      aiGenerated: validQuestions.length >= requestedCount
    };

  } catch (error: any) {
    console.error('❌ OpenAI generation failed:', error.message);

    // Categorize error for better user feedback
    let fallbackReason = 'AI generation failed';
    
    if (error.message?.includes('API key')) {
      fallbackReason = 'Invalid OpenAI API key';
    } else if (error.message?.includes('rate limit')) {
      fallbackReason = 'OpenAI API rate limit reached';
    } else if (error.message?.includes('quota')) {
      fallbackReason = 'OpenAI API quota exceeded';
    } else if (error.message?.includes('network') || error.code === 'ENOTFOUND') {
      fallbackReason = 'Network connection error';
    }

    // Fallback to sample questions
    console.log('🔄 Falling back to sample questions...');
    const sampleQuestions = getSampleQuestions(params.difficulty);
    const selectedQuestions = sampleQuestions.slice(0, params.count);

    // Pad with repeated questions if needed
    while (selectedQuestions.length < params.count) {
      const remaining = params.count - selectedQuestions.length;
      const additionalQuestions = sampleQuestions.slice(0, remaining);
      selectedQuestions.push(...additionalQuestions);
    }

    return {
      questions: selectedQuestions.slice(0, params.count),
      aiGenerated: false,
      fallbackReason
    };
  }
};

/**
 * POST /api/questions/generate
 * Generate quiz questions using AI or fallback samples
 */
router.post('/generate', async (req: Request, res: Response) => {
  try {
    console.log('📝 Question generation request:', req.body);

    // Validate request
    const validation = validateQuestionRequest(req.body);
    if (!validation.valid) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.errors
      } as ErrorResponse);
    }

    const params: QuestionGenerationParams = {
      topic: req.body.topic.trim(),
      difficulty: req.body.difficulty as DifficultyLevel,
      count: req.body.count
    };

    // Generate questions
    const result = await generateQuestions(params);

    console.log(`✅ Question generation complete: ${result.questions.length} questions, AI: ${result.aiGenerated}`);

    res.status(200).json(result);

  } catch (error: any) {
    console.error('❌ Error in question generation endpoint:', error);
    res.status(500).json({
      error: 'Failed to generate questions',
      details: error.message
    } as ErrorResponse);
  }
});

/**
 * GET /api/questions/sample/:difficulty
 * Get sample questions for a specific difficulty
 */
router.get('/sample/:difficulty', (req: Request, res: Response) => {
  try {
    const { difficulty } = req.params;

    if (!['easy', 'medium', 'hard'].includes(difficulty)) {
      return res.status(400).json({
        error: 'Invalid difficulty level',
        details: ['Difficulty must be one of: easy, medium, hard']
      } as ErrorResponse);
    }

    const questions = getSampleQuestions(difficulty as DifficultyLevel);
    
    res.status(200).json({
      questions,
      aiGenerated: false,
      fallbackReason: 'Sample questions requested'
    } as QuestionGenerationResponse);

  } catch (error: any) {
    console.error('❌ Error getting sample questions:', error);
    res.status(500).json({
      error: 'Failed to get sample questions',
      details: error.message
    } as ErrorResponse);
  }
});

export default router; 