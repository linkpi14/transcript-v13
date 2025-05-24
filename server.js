const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const OpenAI = require('openai');
const cors = require('cors');
const fs = require('fs-extra');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Configurar OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Configurar storage do multer
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = 'uploads/';
    fs.ensureDirSync(uploadDir);
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /mp3|mp4|wav|m4a|webm|avi|mov|flv|wmv|mkv/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype) || 
                    file.mimetype.startsWith('video/') || 
                    file.mimetype.startsWith('audio/');
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Formato de arquivo não suportado!'));
    }
  }
});

// Função para verificar se FFmpeg está instalado
function checkFFmpeg() {
  return new Promise((resolve, reject) => {
    ffmpeg.getAvailableFormats((err, formats) => {
      if (err) {
        reject(new Error('FFmpeg não encontrado. Por favor, instale o FFmpeg e adicione ao PATH do sistema.'));
      } else {
        resolve(true);
      }
    });
  });
}

// Função para converter vídeo para MP3
function convertToMp3(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .toFormat('mp3')
      .audioCodec('libmp3lame')
      .audioBitrate(128)
      .on('start', (commandLine) => {
        console.log('FFmpeg command: ' + commandLine);
      })
      .on('progress', (progress) => {
        console.log('Progresso: ' + Math.round(progress.percent) + '%');
      })
      .on('end', () => {
        console.log('Conversão concluída!');
        resolve(outputPath);
      })
      .on('error', (err) => {
        console.error('Erro na conversão:', err);
        reject(err);
      })
      .save(outputPath);
  });
}

// Função para transcrever áudio
async function transcribeAudio(audioPath) {
  try {
    const audioFile = fs.createReadStream(audioPath);
    const response = await openai.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
      language: 'pt'
    });
    return response.text;
  } catch (error) {
    console.error('Erro na transcrição:', error);
    throw error;
  }
}

// Rota principal
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Rota para verificar status do FFmpeg
app.get('/check-ffmpeg', async (req, res) => {
  try {
    await checkFFmpeg();
    res.json({ status: 'ok', message: 'FFmpeg está instalado e funcionando' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// Rota para upload e transcrição
app.post('/transcribe', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  }

  const inputPath = req.file.path;
  const outputPath = path.join('uploads', `converted-${Date.now()}.mp3`);

  try {
    // Verificar se FFmpeg está disponível
    await checkFFmpeg();

    let audioPath = inputPath;

    // Se não for MP3, converter
    if (path.extname(req.file.originalname).toLowerCase() !== '.mp3') {
      console.log('Convertendo arquivo para MP3...');
      audioPath = await convertToMp3(inputPath, outputPath);
    }

    // Transcrever áudio
    console.log('Transcrevendo áudio...');
    const transcription = await transcribeAudio(audioPath);

    // Limpar arquivos temporários
    await fs.remove(inputPath);
    if (audioPath !== inputPath) {
      await fs.remove(audioPath);
    }

    res.json({ 
      success: true, 
      transcription: transcription,
      originalFilename: req.file.originalname
    });

  } catch (error) {
    console.error('Erro no processamento:', error);
    
    // Limpar arquivos em caso de erro
    try {
      await fs.remove(inputPath);
      if (fs.existsSync(outputPath)) {
        await fs.remove(outputPath);
      }
    } catch (cleanupError) {
      console.error('Erro na limpeza:', cleanupError);
    }

    res.status(500).json({ 
      error: 'Erro no processamento', 
      details: error.message 
    });
  }
});

// Iniciar servidor
app.listen(port, async () => {
  console.log(`Servidor rodando na porta ${port}`);
  
  // Verificar FFmpeg na inicialização
  try {
    await checkFFmpeg();
    console.log('✅ FFmpeg está instalado e funcionando');
  } catch (error) {
    console.error('❌ Erro:', error.message);
    console.log('\n📋 Para instalar o FFmpeg:');
    console.log('Windows: choco install ffmpeg');
    console.log('macOS: brew install ffmpeg');
    console.log('Linux: sudo apt install ffmpeg');
  }
});
