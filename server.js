import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { OpenAI } from 'openai';
import ytdl from 'ytdl-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Configurar FFmpeg
ffmpeg.setFfmpegPath(ffmpegStatic);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('dist'));

// Configurar OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'sua-chave-aqui'
});

// Configurar Multer para upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir);
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB
});

// =============================================
// FUNÇÕES AUXILIARES
// =============================================

// Função para converter vídeo para MP3
const convertVideoToMp3 = (inputPath, outputPath) => {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .audioCodec('mp3')
      .audioFrequency(16000) // Whisper funciona melhor com 16kHz
      .audioChannels(1) // Mono para reduzir tamanho
      .audioBitrate('64k') // Bitrate menor para economizar
      .format('mp3')
      .on('start', (commandLine) => {
        console.log('FFmpeg iniciado:', commandLine);
      })
      .on('progress', (progress) => {
        console.log(`Progresso: ${Math.round(progress.percent || 0)}%`);
      })
      .on('end', () => {
        console.log('Conversão concluída:', outputPath);
        resolve(outputPath);
      })
      .on('error', (err) => {
        console.error('Erro na conversão:', err);
        reject(err);
      })
      .save(outputPath);
  });
};

// Função para limpar arquivos temporários
const cleanupFile = (filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log('Arquivo removido:', filePath);
    }
  } catch (error) {
    console.error('Erro ao remover arquivo:', filePath, error);
  }
};

// Função para obter informações do arquivo de mídia
const getMediaInfo = (filePath) => {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        reject(err);
      } else {
        resolve(metadata);
      }
    });
  });
};

// =============================================
// ROTAS DA API
// =============================================

// Rota para transcrever YouTube
app.post('/api/transcribe-youtube', async (req, res) => {
  let audioPath = null;
  let mp3Path = null;

  try {
    const { url } = req.body;
    
    if (!ytdl.validateURL(url)) {
      return res.status(400).json({ 
        error: 'URL do YouTube inválida' 
      });
    }

    console.log('Processando YouTube:', url);
    
    // Baixar áudio do YouTube
    audioPath = `temp_youtube_${Date.now()}.webm`;
    mp3Path = `temp_youtube_${Date.now()}.mp3`;

    const audioStream = ytdl(url, {
      filter: 'audioonly',
      quality: 'highestaudio'
    });

    const writeStream = fs.createWriteStream(audioPath);
    audioStream.pipe(writeStream);

    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    console.log('Áudio baixado, convertendo para MP3...');

    // Converter para MP3
    await convertVideoToMp3(audioPath, mp3Path);

    // Transcrever com OpenAI (ou simulação)
    let transcription;
    if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'sua-chave-aqui') {
      const response = await openai.audio.transcriptions.create({
        file: fs.createReadStream(mp3Path),
        model: "whisper-1",
        language: "pt", // Especificar português para melhor precisão
      });
      transcription = response.text;
    } else {
      // Simulação para demonstração
      transcription = `Transcrição simulada do vídeo YouTube: ${url}\n\nEsta é uma demonstração. Para funcionar de verdade, você precisa:\n1. Configurar sua chave da OpenAI\n2. Adicionar OPENAI_API_KEY nas variáveis de ambiente\n\nO vídeo foi baixado e convertido para MP3 com sucesso. Esta seria a transcrição real do áudio.`;
    }

    res.json({ transcription });

  } catch (error) {
    console.error('Erro YouTube:', error);
    res.status(500).json({ 
      error: 'Erro ao processar vídeo do YouTube: ' + error.message 
    });
  } finally {
    // Limpar arquivos temporários
    cleanupFile(audioPath);
    cleanupFile(mp3Path);
  }
});

// Rota para transcrever Instagram
app.post('/api/transcribe-instagram', async (req, res) => {
  try {
    const { url } = req.body;
    
    console.log('Processando Instagram:', url);
    
    // Para Instagram, você precisaria usar bibliotecas específicas
    // Por enquanto, simulação
    const transcription = `Transcrição simulada do Instagram: ${url}\n\nEsta é uma demonstração. Para Instagram funcionar de verdade, você precisa:\n1. Implementar downloader do Instagram (instaloader, etc.)\n2. Configurar autenticação se necessário\n3. Processar diferentes tipos de mídia (Reels, IGTV, Posts)\n\nO conteúdo seria baixado, convertido para MP3 e transcrito automaticamente.`;

    res.json({ transcription });

  } catch (error) {
    console.error('Erro Instagram:', error);
    res.status(500).json({ 
      error: 'Erro ao processar vídeo do Instagram: ' + error.message 
    });
  }
});

// Rota para upload de arquivo
app.post('/api/transcribe-file', upload.single('video'), async (req, res) => {
  let mp3Path = null;

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    }

    console.log('Processando arquivo:', req.file.filename);

    // Obter informações do arquivo
    try {
      const mediaInfo = await getMediaInfo(req.file.path);
      console.log('Informações do arquivo:', {
        formato: mediaInfo.format.format_name,
        duração: mediaInfo.format.duration,
        tamanho: mediaInfo.format.size
      });

      // Verificar se tem streams de áudio
      const hasAudio = mediaInfo.streams.some(stream => stream.codec_type === 'audio');
      if (!hasAudio) {
        throw new Error('O arquivo não contém áudio para transcrição');
      }
    } catch (error) {
      console.error('Erro ao analisar arquivo:', error);
      return res.status(400).json({ 
        error: 'Arquivo de mídia inválido ou sem áudio: ' + error.message 
      });
    }

    // Definir caminho do MP3
    const fileExtension = path.extname(req.file.filename);
    const baseName = path.basename(req.file.filename, fileExtension);
    mp3Path = path.join('uploads', `${baseName}_converted.mp3`);

    console.log('Convertendo para MP3...');

    // Converter para MP3
    await convertVideoToMp3(req.file.path, mp3Path);

    let transcription;
    if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'sua-chave-aqui') {
      console.log('Enviando para Whisper...');
      const response = await openai.audio.transcriptions.create({
        file: fs.createReadStream(mp3Path),
        model: "whisper-1",
        language: "pt", // Especificar português para melhor precisão
      });
      transcription = response.text;
    } else {
      transcription = `Transcrição simulada do arquivo: ${req.file.originalname}\n\nEsta é uma demonstração. O arquivo foi recebido e processado com sucesso:\n- Nome: ${req.file.originalname}\n- Tamanho: ${(req.file.size / 1024 / 1024).toFixed(2)}MB\n- Tipo: ${req.file.mimetype}\n\nO arquivo foi convertido para MP3 e estaria pronto para transcrição.\nPara funcionar de verdade, configure sua chave da OpenAI.`;
    }

    res.json({ transcription });

  } catch (error) {
    console.error('Erro arquivo:', error);
    res.status(500).json({ 
      error: 'Erro ao processar arquivo: ' + error.message 
    });
  } finally {
    // Limpar arquivos
    cleanupFile(req.file?.path);
    cleanupFile(mp3Path);
  }
});

// Rota de health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    hasOpenAI: !!(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'sua-chave-aqui')
  });
});

// Servir frontend em produção
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`📱 Acesse: http://localhost:${PORT}`);
  console.log(`🔧 FFmpeg configurado: ${ffmpegStatic}`);
  console.log(`🤖 OpenAI configurado: ${!!(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'sua-chave-aqui')}`);
});
