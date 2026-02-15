import React, { useState, useRef, useCallback } from 'react';
import {
  Upload,
  Download,
  Settings,
  Plus,
  ZoomIn,
  ZoomOut,
  X,
  RefreshCw,
  Trash2,
  Edit,
  Check,
  Loader2,
  FileText,
  Image as ImageIcon,
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

interface Card {
  id: string;
  oracle_id: string;
  name: string;
  set: string;
  collector_number: string;
  image_uris?: {
    small: string;
    normal: string;
    large: string;
    png: string;
    border_crop: string;
  };
  card_faces?: Array<{
    image_uris?: {
      small: string;
      normal: string;
      large: string;
      png: string;
      border_crop: string;
    };
  }>;
  highres_image: boolean;
  border_color: string;
  frame: string;
  digital: boolean;
  lang: string;
  nonfoil: boolean;
  layout: string;
  quantity: number;
  type_line?: string;
  oracle_text?: string;
  all_parts?: Array<{
    id: string;
    component: string;
    name: string;
  }>;
}

interface ProgressState {
  active: boolean;
  current: number;
  total: number;
  message: string;
}

interface DecklistState {
  cards: Card[];
  tokens: Card[];
}

interface PrintSettings {
  paper: string;
  customWidth: number;
  customHeight: number;
  orientation: 'portrait' | 'landscape';
  scale: number;
  cardWidth: number;
  cardHeight: number;
  columns: number;
  rows: number;
  gapX: number;
  gapY: number;
  autoCenter: boolean;
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
  borderCrop: number;
  bleed: number;
  background: string;
  cropmarks: boolean;
  faces: 'all' | 'front' | 'back';
  format: 'pdf' | 'png' | 'jpg';
  dpi: number;
  quality: 'low' | 'medium' | 'high';
  colorMode: 'color' | 'grayscale';
}

interface SettingDefinition {
  key: keyof PrintSettings;
  label: string;
  type: 'select' | 'number' | 'range' | 'checkbox' | 'color';
  options?: string[];
  getLabel?: (value: string) => string;
  min?: number;
  max?: number;
  step?: number;
  condition?: boolean;
}

const STEPS = [
  { id: 1, title: 'Загрузка', icon: Upload },
  { id: 2, title: 'Токены', icon: Plus },
  { id: 3, title: 'Версии', icon: Edit },
  { id: 4, title: 'Печать', icon: Settings },
  { id: 5, title: 'Экспорт', icon: Download },
];

const PAPER_SIZES: Record<string, { width: number; height: number; name: string }> = {
  a4: { width: 210, height: 297, name: 'A4 (210×297 мм)' },
  a3: { width: 297, height: 420, name: 'A3 (297×420 мм)' },
  letter: { width: 215.9, height: 279.4, name: 'Letter (8.5×11")' },
  legal: { width: 215.9, height: 355.6, name: 'Legal (8.5×14")' },
  tabloid: { width: 279.4, height: 431.8, name: 'Tabloid (11×17")' },
  custom: { width: 210, height: 297, name: 'Произвольный' },
};

export function App() {
  const [currentStep, setCurrentStep] = useState(1);
  const [deckText, setDeckText] = useState('');
  const [decklist, setDecklist] = useState<DecklistState>({ cards: [], tokens: [] });
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [progress, setProgress] = useState<ProgressState>({ active: false, current: 0, total: 0, message: '' });
  const [clean, setClean] = useState(false);
  const [improve, setImprove] = useState(false);
  const [foundTokens, setFoundTokens] = useState<Card[]>([]);
  const [selectedTokens, setSelectedTokens] = useState<Set<string>>(new Set());
  const [tokenQuantities, setTokenQuantities] = useState<Record<string, number>>({});
  const [replacingCard, setReplacingCard] = useState<Card | null>(null);
  const [alternativePrints, setAlternativePrints] = useState<Card[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Card[]>([]);
  const [printSettings, setPrintSettings] = useState<PrintSettings>({
    paper: 'a4',
    customWidth: 210,
    customHeight: 297,
    orientation: 'portrait',
    scale: 1.0,
    cardWidth: 63.5,
    cardHeight: 88.9,
    columns: 3,
    rows: 3,
    gapX: 0,
    gapY: 0,
    autoCenter: true,
    marginTop: 0,
    marginBottom: 0,
    marginLeft: 0,
    marginRight: 0,
    borderCrop: 0,
    bleed: 0,
    background: '#ffffff',
    cropmarks: false,
    faces: 'all',
    format: 'pdf',
    dpi: 300,
    quality: 'high',
    colorMode: 'color',
  });
  const [previewZoom, setPreviewZoom] = useState(0.5);
  const [showPreview, setShowPreview] = useState(false);
  const [highresFilter, setHighresFilter] = useState(true);
  const [blackBorderFilter, setBlackBorderFilter] = useState(false);
  const [nonDigitalFilter, setNonDigitalFilter] = useState(true);
  const [parseError, setParseError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const dragCounter = useRef(0);
  const [isDragging, setIsDragging] = useState(false);
  const imageDataCache = useRef<Map<string, string>>(new Map());
  const cancelProcessRef = useRef(false);

  const getCardImageUrl = (
    card: Card,
    size: 'small' | 'normal' | 'large' | 'png' | 'border_crop' = 'normal'
  ): string | undefined => {
    if (card.image_uris?.[size]) return card.image_uris[size];
    if (card.card_faces?.[0]?.image_uris?.[size]) return card.card_faces[0].image_uris[size];
    return undefined;
  };

  const fetchImageDataUrl = async (url: string, retries = 5): Promise<string> => {
    if (imageDataCache.current.has(url)) {
      return imageDataCache.current.get(url)!;
    }

    try {
      await new Promise((r) => setTimeout(r, 150));

      const response = await fetch(url, { mode: 'cors' });
      if (!response.ok) {
        if (response.status === 429 && retries > 0) {
          await new Promise((r) => setTimeout(r, 2000));
          return fetchImageDataUrl(url, retries - 1);
        }
        throw new Error('Ошибка загрузки: ' + response.status);
      }

      const blob = await response.blob();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Ошибка конвертации изображения'));
        reader.readAsDataURL(blob);
      });

      imageDataCache.current.set(url, dataUrl);
      return dataUrl;
    } catch (e) {
      if (retries > 0) {
        await new Promise((r) => setTimeout(r, 2000));
        return fetchImageDataUrl(url, retries - 1);
      }
      throw e;
    }
  };

  const fetchWithRateLimit = async (url: string, delay: number = 50): Promise<Response> => {
    await new Promise((r) => setTimeout(r, delay));
    const response = await fetch(url);
    if (response.status === 429) {
      await new Promise((r) => setTimeout(r, 1000));
      return fetchWithRateLimit(url, 200);
    }
    return response;
  };

  const updateProgress = useCallback((current: number, total: number, message: string) => {
    setProgress({
      active: total > 0,
      current,
      total,
      message,
    });
  }, []);

  const getPaperSize = () => {
    if (printSettings.paper === 'custom') {
      return { width: printSettings.customWidth, height: printSettings.customHeight };
    }
    return PAPER_SIZES[printSettings.paper] || PAPER_SIZES.a4;
  };

  const computeLayout = () => {
    const { width: pageWidth, height: pageHeight } = getPaperSize();
    const cardWidth = printSettings.cardWidth * printSettings.scale;
    const cardHeight = printSettings.cardHeight * printSettings.scale;
    const gapX = printSettings.gapX;
    const gapY = printSettings.gapY;
    const columns = printSettings.columns;
    const rows = printSettings.rows;
    const contentWidth = columns * cardWidth + (columns - 1) * gapX;
    const contentHeight = rows * cardHeight + (rows - 1) * gapY;

    const marginLeft = printSettings.autoCenter
      ? Math.max(0, (pageWidth - contentWidth) / 2)
      : printSettings.marginLeft;
    const marginTop = printSettings.autoCenter
      ? Math.max(0, (pageHeight - contentHeight) / 2)
      : printSettings.marginTop;

    return {
      pageWidth,
      pageHeight,
      cardWidth,
      cardHeight,
      gapX,
      gapY,
      columns,
      rows,
      marginLeft,
      marginTop,
    };
  };

  const expandCards = (cards: Card[]) =>
    cards.flatMap((card) => Array.from({ length: card.quantity }, () => ({ ...card })));

  const fetchCardByName = async (name: string, setCode?: string, collectorNum?: string): Promise<Card | null> => {
    try {
      let query = `!"${name}"`;
      if (setCode) query += ` set:${setCode}`;
      if (collectorNum) query += ` number:${collectorNum}`;

      const response = await fetchWithRateLimit(
        `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&unique=prints`
      );
      if (!response.ok) {
        const fuzzyResponse = await fetchWithRateLimit(
          `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}`
        );
        if (fuzzyResponse.ok) {
          return await fuzzyResponse.json();
        }
        return null;
      }
      const data = await response.json();
      if (data.data && data.data.length > 0) {
        return data.data[0];
      }
      return null;
    } catch (e) {
      console.error('Ошибка поиска карты:', e);
      return null;
    }
  };

  const findBestCardVersion = async (card: Card): Promise<Card | null> => {
    try {
      const response = await fetchWithRateLimit(
        `https://api.scryfall.com/cards/search?q=oracle_id:${card.oracle_id}&unique=prints`
      );
      if (!response.ok) return null;

      const data = await response.json();
      if (!data.data || data.data.length === 0) return null;

      let bestCard = data.data[0];
      let bestScore = -1;

      for (const print of data.data) {
        let score = 0;
        if (print.highres_image) score += 100;
        if (print.image_uris?.png) score += 50;
        else if (print.image_uris?.border_crop) score += 40;
        else if (print.image_uris?.large) score += 30;

        if (print.border_color === 'black') score += 20;
        else if (print.border_color === 'white') score += 10;

        if (print.frame === '2015') score += 15;
        if (!print.digital) score += 10;
        if (print.lang === 'en') score += 5;
        if (print.nonfoil) score += 5;

        const collectorNum = print.collector_number || '';
        if (collectorNum && !collectorNum.match(/[ps★]$/i)) score += 3;

        if (score > bestScore) {
          bestScore = score;
          bestCard = print;
        }
      }

      return bestCard;
    } catch (e) {
      return null;
    }
  };

  const parseDecklist = async () => {
    if (!deckText.trim()) {
      setParseError('Введите деклист');
      return;
    }

    cancelProcessRef.current = false;
    const lines = deckText
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#') && !line.startsWith('//'));
    const totalLines = lines.length;
    const parsedCards: Card[] = [];
    const errors: string[] = [];

    updateProgress(0, totalLines, 'Разбор деклиста...');

    try {
      for (let i = 0; i < lines.length; i++) {
        if (cancelProcessRef.current) break;
        const line = lines[i];

        const match =
          line.match(/^(\d+)\s+(.+?)(?:\s+\[(\w+):(\w+)\])?(?:\s+\((\w+)\)\s+(\w+))?\s*$/i) ||
          line.match(/^(\d+)\s+(.+)$/);

        if (match) {
          const [, quantityStr, name, setBracket, numBracket, setParen, numParen] = match;
          const quantity = parseInt(quantityStr, 10);
          const setCode = setBracket || setParen;
          const collectorNum = numBracket || numParen;

          updateProgress(i + 1, totalLines, `Загрузка: ${name}...`);

          const card = await fetchCardByName(name, setCode, collectorNum);
          if (card) {
            if (improve) {
              const bestCard = await findBestCardVersion(card);
              if (bestCard) {
                parsedCards.push({ ...bestCard, quantity });
              } else {
                parsedCards.push({ ...card, quantity });
              }
            } else {
              parsedCards.push({ ...card, quantity });
            }
          } else if (!clean) {
            errors.push(`"${name}" не найдена`);
          }
        } else if (!clean) {
          errors.push(`Строка не распознана: ${line}`);
        }

        await new Promise((r) => setTimeout(r, 30));
      }

      if (!cancelProcessRef.current) {
        if (errors.length > 0) {
          setParseError(`${errors.length} ошибок:\n${errors.slice(0, 5).join('\n')}${errors.length > 5 ? '\n...' : ''}`);
        } else {
          setParseError(null);
        }

        setDecklist({ cards: parsedCards, tokens: [] });

        if (parsedCards.length > 0) {
          updateProgress(totalLines, totalLines, 'Готово!');
          setTimeout(() => {
            setProgress({ active: false, current: 0, total: 0, message: '' });
            setCurrentStep(2);
          }, 500);
        } else {
          setProgress({ active: false, current: 0, total: 0, message: '' });
        }
      }
    } catch (error) {
      setParseError('Ошибка разбора деклиста');
      updateProgress(0, 0, '');
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) readFile(file);
  };

  const readFile = (file: File) => {
    if (file.size > 1024 * 1024) {
      setParseError('Файл слишком большой (макс. 1MB)');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      setDeckText(e.target?.result as string);
      setParseError(null);
    };
    reader.readAsText(file);
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current++;
    if (e.dataTransfer.items?.length) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current === 0) setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    dragCounter.current = 0;
    if (e.dataTransfer.files?.[0]) {
      const file = e.dataTransfer.files[0];
      if (file.name.endsWith('.txt')) readFile(file);
      else setParseError('Разрешены только .txt файлы');
    }
  };

  const findTokens = async () => {
    if (decklist.cards.length === 0) return;

    cancelProcessRef.current = false;
    const tokens: Card[] = [];
    const tokenNames = new Set<string>();
    const processedCards = new Set<string>();
    const cards = decklist.cards;
    const total = cards.length;

    updateProgress(0, total, 'Поиск токенов...');

    try {
      for (let i = 0; i < cards.length; i++) {
        if (cancelProcessRef.current) break;
        const card = cards[i];
        updateProgress(i + 1, total, `Проверяем: ${card.name}...`);

        if (processedCards.has(card.oracle_id)) continue;
        processedCards.add(card.oracle_id);

        const response = await fetchWithRateLimit(
          `https://api.scryfall.com/cards/search?q=oracle_id:${card.oracle_id}&unique=prints`
        );
        if (response.ok) {
          const data = await response.json();
          for (const print of data.data || []) {
            if (print.all_parts) {
              for (const part of print.all_parts) {
                if (part.component === 'token' && !tokenNames.has(part.name)) {
                  tokenNames.add(part.name); // immediately add to prevent duplicate calls for same token name
                  const tokenResponse = await fetchWithRateLimit(`https://api.scryfall.com/cards/${part.id}`);
                  if (tokenResponse.ok) {
                    const token = await tokenResponse.json();
                    if (token.layout === 'token' || token.type_line?.includes('Token')) {
                      const bestToken = await findBestCardVersion(token) || token;
                      tokens.push(bestToken);
                    }
                  }
                }
              }
            }
          }
        }
      }

      if (!cancelProcessRef.current) {
        setFoundTokens(tokens);
        const quantities: Record<string, number> = {};
        tokens.forEach((t) => (quantities[t.id] = 1));
        setTokenQuantities(quantities);
        setSelectedTokens(new Set(tokens.map((t) => t.id)));
        updateProgress(total, total, `Найдено токенов: ${tokens.length}`);

        setTimeout(() => setProgress({ active: false, current: 0, total: 0, message: '' }), 1000);
      }
    } catch (e) {
      console.error(e);
      setProgress({ active: false, current: 0, total: 0, message: '' });
    }
  };

  const addSelectedTokens = () => {
    const tokensToAdd = foundTokens
      .filter((t) => selectedTokens.has(t.id))
      .map((t) => ({ ...t, quantity: tokenQuantities[t.id] || 1 }));
    setDecklist({ ...decklist, tokens: [...decklist.tokens, ...tokensToAdd] });
  };

  const handleReplaceCard = async (card: Card) => {
    setReplacingCard(card);
    updateProgress(0, 1, 'Загрузка версий...');

    try {
      const response = await fetchWithRateLimit(
        `https://api.scryfall.com/cards/search?q=oracle_id:${card.oracle_id}&unique=prints&order=released&dir=desc`
      );
      if (response.ok) {
        const data = await response.json();
        const prints = (data.data || []).sort((a: Card, b: Card) => getCardScore(b) - getCardScore(a));
        setAlternativePrints(prints);
      }
    } catch (e) {
      console.error(e);
    }
    updateProgress(1, 1, 'Готово');
    setTimeout(() => setProgress({ active: false, current: 0, total: 0, message: '' }), 500);
  };

  const applyReplacement = (newCard: Card) => {
    const oldCard = replacingCard;
    if (!oldCard) return;

    const updatedCards = decklist.cards.map((c) => (c.id === oldCard.id ? { ...newCard, quantity: c.quantity } : c));
    setDecklist({ ...decklist, cards: updatedCards });
    setReplacingCard(null);
    setAlternativePrints([]);
  };

  const getCardScore = (card: Card) => {
    let score = 0;
    if (card.highres_image) score += 100;
    if (card.image_uris?.png || card.card_faces?.[0]?.image_uris?.png) score += 50;
    if (card.border_color === 'black') score += 20;
    else if (card.border_color === 'white') score += 10;
    if (card.frame === '2015') score += 15;
    if (!card.digital) score += 10;
    if (card.lang === 'en') score += 5;
    if (card.nonfoil) score += 5;
    return score;
  };

  const applyGlobalFilters = async () => {
    cancelProcessRef.current = false;
    const cards = decklist.cards;
    const total = cards.length;

    updateProgress(0, total, 'Применяем фильтры...');

    const improvedCards: Card[] = [];

    for (let i = 0; i < cards.length; i++) {
      if (cancelProcessRef.current) break;
      const card = cards[i];
      updateProgress(i + 1, total, `Обработка: ${card.name}...`);

      try {
        const response = await fetchWithRateLimit(
          `https://api.scryfall.com/cards/search?q=oracle_id:${card.oracle_id}&unique=prints`
        );
        if (response.ok) {
          const data = await response.json();
          const prints = data.data || [];

          let bestCard = card;
          let bestScore = getCardScore(card);

          for (const print of prints) {
            const score = getCardScore(print);

            if (highresFilter && !print.highres_image) continue;
            if (blackBorderFilter && print.border_color !== 'black') continue;
            if (nonDigitalFilter && print.digital) continue;

            if (score > bestScore) {
              bestScore = score;
              bestCard = print;
            }
          }

          improvedCards.push({ ...bestCard, quantity: card.quantity });
        } else {
          improvedCards.push(card);
        }
      } catch (e) {
        improvedCards.push(card);
      }
    }

    if (!cancelProcessRef.current) {
      setDecklist({ ...decklist, cards: improvedCards });
      updateProgress(total, total, 'Фильтры применены');
      setTimeout(() => setProgress({ active: false, current: 0, total: 0, message: '' }), 1000);
    }
  };

  const updateCardQuantity = (cardId: string, newQuantity: number) => {
    if (newQuantity < 1) return;
    setDecklist({
      ...decklist,
      cards: decklist.cards.map((c) => (c.id === cardId ? { ...c, quantity: newQuantity } : c)),
    });
  };

  const removeCard = (cardId: string) => {
    setDecklist({ ...decklist, cards: decklist.cards.filter((c) => c.id !== cardId) });
  };

  const searchCards = async () => {
    if (!searchQuery.trim()) return;
    updateProgress(0, 1, 'Поиск...');
    try {
      const response = await fetchWithRateLimit(
        `https://api.scryfall.com/cards/search?q=${encodeURIComponent(searchQuery)}&unique=cards`
      );
      if (response.ok) {
        const data = await response.json();
        setSearchResults(data.data || []);
      }
    } catch (e) {
      setSearchResults([]);
    }
    setProgress({ active: false, current: 0, total: 0, message: '' });
  };

  const addCardToDeck = (card: Card) => {
    setDecklist({ ...decklist, cards: [...decklist.cards, { ...card, quantity: 1 }] });
    setSearchResults([]);
    setSearchQuery('');
  };

  const downloadDeckText = () => {
    const lines: string[] = [];

    if (decklist.cards.length > 0) {
      lines.push('// Основная колода');
      decklist.cards.forEach((card) => {
        lines.push(`${card.quantity} ${card.name} (${card.set}) ${card.collector_number}`);
      });
    }

    if (decklist.tokens.length > 0) {
      lines.push('');
      lines.push('// Токены');
      decklist.tokens.forEach((token) => {
        lines.push(`${token.quantity} ${token.name} (${token.set}) ${token.collector_number}`);
      });
    }

    const text = lines.join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'deck.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const generatePDF = async () => {
    cancelProcessRef.current = false;
    const allCards = [...decklist.cards, ...decklist.tokens];
    const expandedCards = expandCards(allCards);
    const cardsPerPage = printSettings.rows * printSettings.columns;
    const totalPages = Math.ceil(expandedCards.length / cardsPerPage);

    updateProgress(0, expandedCards.length, 'Генерация PDF...');

    try {
      const pdf = new jsPDF({
        orientation: printSettings.orientation,
        unit: 'mm',
        format:
          printSettings.paper === 'custom'
            ? [printSettings.customWidth, printSettings.customHeight]
            : printSettings.paper,
      });

      const layout = computeLayout();
      let currentIndex = 0;

      for (let page = 0; page < totalPages; page++) {
        if (cancelProcessRef.current) break;
        if (page > 0) pdf.addPage();

        for (let row = 0; row < layout.rows; row++) {
          if (cancelProcessRef.current) break;
          for (let col = 0; col < layout.columns; col++) {
            if (cancelProcessRef.current) break;
            if (currentIndex >= expandedCards.length) break;

            const card = expandedCards[currentIndex];
            const x = layout.marginLeft + col * (layout.cardWidth + layout.gapX);
            const y = layout.marginTop + row * (layout.cardHeight + layout.gapY);

            const urisToTry = [
              getCardImageUrl(card, 'png'),
              getCardImageUrl(card, 'large'),
              getCardImageUrl(card, 'normal')
            ].filter(Boolean) as string[];

            let dataUrl = null;
            for (const uri of urisToTry) {
              if (cancelProcessRef.current) break;
              try {
                dataUrl = await fetchImageDataUrl(uri, 5); // 5 retries
                if (dataUrl) break;
              } catch (e) {
                console.warn(`Failed to load ${uri} for ${card.name}, trying next...`);
              }
            }

            if (cancelProcessRef.current) break;

            if (dataUrl) {
              try {
                const bleedMm = printSettings.bleed;
                const cropMm = (printSettings.borderCrop / printSettings.dpi) * 25.4;
                pdf.addImage(
                  dataUrl,
                  'PNG',
                  x - bleedMm - cropMm,
                  y - bleedMm - cropMm,
                  layout.cardWidth + bleedMm * 2 + cropMm * 2,
                  layout.cardHeight + bleedMm * 2 + cropMm * 2
                );
              } catch (e) {
                throw new Error(`Ошибка вставки изображения для ${card.name}`);
              }
            } else {
              throw new Error(`Не удалось загрузить изображение для карты "${card.name}". Проверьте подключение к интернету или попробуйте выбрать другую версию карты (без цифровых).`);
            }

            if (printSettings.cropmarks) {
              const markLen = 3;
              const offset = 2;
              pdf.setDrawColor(200, 0, 0);
              pdf.setLineWidth(0.1);
              pdf.line(x + layout.cardWidth / 2 - markLen, y - offset, x + layout.cardWidth / 2 + markLen, y - offset);
              pdf.line(
                x + layout.cardWidth / 2 - markLen,
                y + layout.cardHeight + offset,
                x + layout.cardWidth / 2 + markLen,
                y + layout.cardHeight + offset
              );
              pdf.line(x - offset, y + layout.cardHeight / 2 - markLen, x - offset, y + layout.cardHeight / 2 + markLen);
              pdf.line(
                x + layout.cardWidth + offset,
                y + layout.cardHeight / 2 - markLen,
                x + layout.cardWidth + offset,
                y + layout.cardHeight / 2 + markLen
              );
            }

            currentIndex++;
            updateProgress(currentIndex, expandedCards.length, `Обработка: ${card.name}`);
          }
        }
      }

      if (!cancelProcessRef.current) {
        updateProgress(expandedCards.length, expandedCards.length, 'Сохранение PDF...');
        pdf.save('mtg-proxy-deck.pdf');
        setProgress({ active: false, current: 0, total: 0, message: '' });
      }
    } catch (error: any) {
      console.error('Ошибка генерации PDF:', error);
      alert(error.message || 'Ошибка генерации PDF');
      setProgress({ active: false, current: 0, total: 0, message: '' });
    }
  };

  const generateImage = async () => {
    if (!previewRef.current) return;

    updateProgress(0, 1, 'Генерация изображения...');

    try {
      const canvas = await html2canvas(previewRef.current, {
        scale: printSettings.dpi / 96,
        backgroundColor: printSettings.background,
        useCORS: true,
        allowTaint: true,
        logging: false,
      });

      const link = document.createElement('a');
      link.download = `mtg-proxy-deck.${printSettings.format === 'jpg' ? 'jpeg' : 'png'}`;
      link.href = canvas.toDataURL(`image/${printSettings.format === 'jpg' ? 'jpeg' : 'png'}`, 1.0);
      link.click();
    } catch (error) {
      console.error('Ошибка генерации изображения:', error);
      alert('Ошибка генерации изображения');
    }

    setProgress({ active: false, current: 0, total: 0, message: '' });
  };

  const renderProgressBar = () => {
    if (!progress.active) return null;

    const percentage = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 w-96 shadow-2xl">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
              <span className="font-medium text-lg">Выполнение</span>
            </div>
            <button
              onClick={() => {
                cancelProcessRef.current = true;
                setProgress({ active: false, current: 0, total: 0, message: '' });
              }}
              className="text-gray-500 hover:text-red-500 transition-colors"
              title="Отмена"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          <div className="mb-2">
            <div className="flex justify-between text-sm text-gray-600 mb-1">
              <span className="truncate pr-2">{progress.message}</span>
              <span>{percentage}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
              <div
                className="bg-blue-500 h-full rounded-full transition-all duration-300"
                style={{ width: `${percentage}%` }}
              />
            </div>
          </div>

          {progress.total > 0 && (
            <p className="text-sm text-gray-500">
              {progress.current} / {progress.total}
            </p>
          )}

          <div className="mt-6 flex justify-end">
            <button
              onClick={() => {
                cancelProcessRef.current = true;
                setProgress({ active: false, current: 0, total: 0, message: '' });
              }}
              className="px-4 py-2 bg-red-100 text-red-700 hover:bg-red-200 rounded text-sm font-medium transition-colors"
            >
              Отменить
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderStep1 = () => (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-lg shadow-md">
        <h3 className="text-lg font-semibold mb-4">📤 Загрузка деклиста</h3>

        <div
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${
            isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'
          }`}
          onClick={() => fileInputRef.current?.click()}
        >
          <input ref={fileInputRef} type="file" accept=".txt" onChange={handleFileUpload} className="hidden" />
          <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600 mb-2">Перетащите файл decklist сюда</p>
          <p className="text-gray-400 text-sm">или нажмите для выбора</p>
        </div>

        <div className="mt-6">
          <label className="block text-sm font-medium mb-2">Или вставьте список вручную:</label>
          <textarea
            value={deckText}
            onChange={(e) => setDeckText(e.target.value)}
            placeholder="1 Island\n1 Lightning Bolt (A25) 142\n1 Black Lotus (LEA) 232"
            className="w-full h-48 p-4 border rounded-lg font-mono text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        {parseError && (
          <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm whitespace-pre-line">
            <div className="flex items-center gap-2 font-semibold mb-1">⚠️ Ошибка</div>
            {parseError}
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={clean} onChange={(e) => setClean(e.target.checked)} className="rounded text-blue-500" />
            <span className="text-sm">Удалять не-карточные строки</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={improve} onChange={(e) => setImprove(e.target.checked)} className="rounded text-blue-500" />
            <span className="text-sm">Авто-улучшение версий</span>
          </label>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            onClick={parseDecklist}
            disabled={progress.active || !deckText.trim()}
            className="px-6 py-2.5 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center gap-2 font-medium"
          >
            {progress.active ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Разобрать деклист
          </button>

          {decklist.cards.length > 0 && (
            <button
              onClick={downloadDeckText}
              className="px-6 py-2.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 flex items-center gap-2 font-medium"
            >
              <Download className="w-4 h-4" />
              Скачать текст
            </button>
          )}
        </div>
      </div>

      {decklist.cards.length > 0 && (
        <div className="bg-white p-6 rounded-lg shadow-md">
          <h3 className="text-lg font-semibold mb-4">
            🃏 Превью ({decklist.cards.reduce((a, c) => a + c.quantity, 0)} карт)
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3">
            {decklist.cards.map((card, idx) => (
              <div key={`${card.id}-${idx}`} className="bg-white rounded-lg shadow overflow-hidden group">
                <div
                  className="aspect-[2.5/3.5] bg-gray-200 cursor-pointer overflow-hidden relative"
                  onClick={() => setSelectedCard(card)}
                >
                  {getCardImageUrl(card, 'normal') ? (
                    <img
                      src={getCardImageUrl(card, 'normal')}
                      alt={card.name}
                      className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-200"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center p-2">
                      <span className="text-xs text-gray-500 text-center">{card.name}</span>
                    </div>
                  )}
                  <div className="absolute bottom-1 right-1 bg-black/70 text-white text-xs px-1.5 py-0.5 rounded">
                    {card.quantity}x
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const renderStep2 = () => (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-lg shadow-md">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">🃏 Добавление токенов</h3>
          <button
            onClick={findTokens}
            disabled={progress.active || decklist.cards.length === 0}
            className="px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 disabled:bg-gray-300 flex items-center gap-2"
          >
            {progress.active ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Найти токены
          </button>
        </div>

        {foundTokens.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-4">
              <h4 className="font-medium">Найдено токенов: {foundTokens.length}</h4>
              <div className="flex gap-2">
                <button
                  onClick={() => setSelectedTokens(new Set(foundTokens.map((t) => t.id)))}
                  className="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300 text-sm"
                >
                  Выбрать все
                </button>
                <button onClick={() => setSelectedTokens(new Set())} className="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300 text-sm">
                  Снять выбор
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3 mb-4">
              {foundTokens.map((token) => (
                <div key={token.id} className="border rounded-lg p-2 bg-white">
                  <div className="flex items-start gap-2 mb-2">
                    <input
                      type="checkbox"
                      checked={selectedTokens.has(token.id)}
                      onChange={(e) => {
                        const newSet = new Set(selectedTokens);
                        e.target.checked ? newSet.add(token.id) : newSet.delete(token.id);
                        setSelectedTokens(newSet);
                      }}
                      className="mt-1 rounded text-blue-500"
                    />
                    <div className="flex-1">
                      {getCardImageUrl(token, 'small') ? (
                        <img
                          src={getCardImageUrl(token, 'small')}
                          alt={token.name}
                          className="w-full rounded cursor-pointer"
                          onClick={() => setSelectedCard(token)}
                        />
                      ) : (
                        <div className="aspect-[2.5/3.5] bg-gray-200 rounded" />
                      )}
                    </div>
                  </div>
                  <p className="text-xs font-medium truncate" title={token.name}>
                    {token.name}
                  </p>
                  <div className="flex items-center gap-1 mt-2">
                    <span className="text-xs text-gray-500">Кол-во:</span>
                    <input
                      type="number"
                      min="1"
                      max="20"
                      value={tokenQuantities[token.id] || 1}
                      onChange={(e) =>
                        setTokenQuantities({
                          ...tokenQuantities,
                          [token.id]: Math.max(1, parseInt(e.target.value, 10) || 1),
                        })
                      }
                      className="w-14 px-2 py-1 border rounded text-sm"
                    />
                  </div>
                </div>
              ))}
            </div>

            <button onClick={addSelectedTokens} className="px-6 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600">
              Добавить выбранные токены ({selectedTokens.size})
            </button>
          </div>
        )}

        <div className="border-t pt-4">
          <h4 className="font-medium mb-3">🔍 Поиск и добавление вручную:</h4>
          <div className="flex gap-2 mb-4">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && searchCards()}
              placeholder="Поиск карты..."
              className="flex-1 px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
            />
            <button onClick={searchCards} disabled={progress.active} className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600">
              Поиск
            </button>
          </div>

          {searchResults.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {searchResults.slice(0, 8).map((card) => (
                <div key={card.id} className="border rounded-lg p-2 bg-white">
                  {getCardImageUrl(card, 'small') ? (
                    <img
                      src={getCardImageUrl(card, 'small')}
                      alt={card.name}
                      className="w-full rounded mb-2 cursor-pointer"
                      onClick={() => setSelectedCard(card)}
                    />
                  ) : (
                    <div className="aspect-[2.5/3.5] bg-gray-200 rounded mb-2" />
                  )}
                  <p className="text-xs font-medium truncate">{card.name}</p>
                  <button
                    onClick={() => addCardToDeck(card)}
                    className="mt-2 w-full px-2 py-1 bg-green-500 text-white text-xs rounded hover:bg-green-600"
                  >
                    Добавить
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {decklist.tokens.length > 0 && (
        <div className="bg-white p-6 rounded-lg shadow-md">
          <h3 className="text-lg font-semibold mb-4">✅ Добавленные токены ({decklist.tokens.reduce((a, c) => a + c.quantity, 0)})</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {decklist.tokens.map((token, idx) => (
              <div key={`${token.id}-${idx}`} className="bg-white rounded-lg shadow overflow-hidden">
                <div className="aspect-[2.5/3.5] bg-gray-200">
                  {getCardImageUrl(token, 'normal') ? (
                    <img src={getCardImageUrl(token, 'normal')} alt={token.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <span className="text-xs text-gray-500">{token.name}</span>
                    </div>
                  )}
                </div>
                <div className="p-2">
                  <p className="text-xs font-semibold truncate">{token.name}</p>
                  <p className="text-xs text-blue-600">Кол-во: {token.quantity}</p>
                  <button
                    onClick={() => setDecklist({ ...decklist, tokens: decklist.tokens.filter((t) => t.id !== token.id) })}
                    className="mt-2 w-full px-2 py-1 bg-red-500 text-white text-xs rounded hover:bg-red-600 flex items-center justify-center gap-1"
                  >
                    <Trash2 className="w-3 h-3" /> Удалить
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const renderStep3 = () => (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-lg shadow-md">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <h3 className="text-lg font-semibold">🔄 Редактирование версий</h3>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={applyGlobalFilters}
              disabled={progress.active}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:bg-gray-300 flex items-center gap-2"
            >
              {progress.active ? <Loader2 className="w-4 h-4 animate-spin" /> : <Settings className="w-4 h-4" />}
              Применить фильтры
            </button>
            <button
              onClick={downloadDeckText}
              className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              Скачать обновленный текст
            </button>
          </div>
        </div>

        <div className="mb-6 p-4 bg-gray-50 rounded-lg">
          <h4 className="font-medium mb-3">⚙️ Глобальные фильтры</h4>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={highresFilter} onChange={(e) => setHighresFilter(e.target.checked)} className="rounded text-blue-500" />
              <span className="text-sm">Только High-Res</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={blackBorderFilter}
                onChange={(e) => setBlackBorderFilter(e.target.checked)}
                className="rounded text-blue-500"
              />
              <span className="text-sm">Черные рамки</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={nonDigitalFilter}
                onChange={(e) => setNonDigitalFilter(e.target.checked)}
                className="rounded text-blue-500"
              />
              <span className="text-sm">Не цифровые</span>
            </label>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3">
          {decklist.cards.map((card, idx) => (
            <div key={`${card.id}-${idx}`} className="bg-white rounded-lg shadow overflow-hidden group">
              <div
                className="aspect-[2.5/3.5] bg-gray-200 cursor-pointer overflow-hidden relative"
                onClick={() => setSelectedCard(card)}
              >
                {getCardImageUrl(card, 'normal') ? (
                  <img src={getCardImageUrl(card, 'normal')} alt={card.name} className="w-full h-full object-cover group-hover:scale-110 transition-transform" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <span className="text-xs text-gray-500">{card.name}</span>
                  </div>
                )}
                <div className="absolute bottom-1 right-1 bg-black/70 text-white text-xs px-1.5 py-0.5 rounded">
                  {card.quantity}x
                </div>
              </div>
              <div className="p-2">
                <p className="text-xs font-semibold truncate" title={card.name}>
                  {card.name}
                </p>
                <p className="text-xs text-gray-500">
                  {card.set?.toUpperCase()} #{card.collector_number}
                </p>

                <div className="flex items-center gap-1 mt-2">
                  <button className="px-2 py-1 bg-gray-200 rounded text-xs hover:bg-gray-300" onClick={() => updateCardQuantity(card.id, card.quantity - 1)}>
                    -
                  </button>
                  <span className="text-xs font-medium w-5 text-center">{card.quantity}</span>
                  <button className="px-2 py-1 bg-gray-200 rounded text-xs hover:bg-gray-300" onClick={() => updateCardQuantity(card.id, card.quantity + 1)}>
                    +
                  </button>
                </div>

                <div className="mt-2 space-y-1">
                  <button onClick={() => handleReplaceCard(card)} className="w-full px-2 py-1 bg-blue-500 text-white text-xs rounded hover:bg-blue-600">
                    Заменить
                  </button>
                  <button onClick={() => removeCard(card.id)} className="w-full px-2 py-1 bg-red-500 text-white text-xs rounded hover:bg-red-600">
                    Удалить
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {replacingCard && alternativePrints.length > 0 && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-white rounded-lg max-w-6xl w-full max-h-screen overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Выберите версию для {replacingCard.name}</h3>
              <button onClick={() => { setReplacingCard(null); setAlternativePrints([]); }} className="p-2 hover:bg-gray-100 rounded-full">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3">
              {alternativePrints.map((print) => {
                const score = getCardScore(print);
                const isCurrent = print.id === replacingCard.id;
                return (
                  <div
                    key={print.id}
                    className={`cursor-pointer rounded-lg overflow-hidden border-2 transition-all ${
                      isCurrent ? 'border-green-500 ring-2 ring-green-200' : 'border-transparent hover:border-blue-500'
                    }`}
                    onClick={() => !isCurrent && applyReplacement(print)}
                  >
                    {getCardImageUrl(print, 'normal') ? (
                      <img src={getCardImageUrl(print, 'normal')} alt={print.name} className="w-full" />
                    ) : (
                      <div className="aspect-[2.5/3.5] bg-gray-200" />
                    )}
                    <div className="p-2 text-sm bg-white">
                      <p className="font-medium">{print.set?.toUpperCase()}</p>
                      <p className="text-gray-500">#{print.collector_number}</p>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-xs text-blue-600">Оценка: {score}</span>
                        {isCurrent && <span className="text-xs text-green-600 font-semibold">Текущая</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const renderStep4 = () => {
    const allCards = [...decklist.cards, ...decklist.tokens];
    const expandedCards = expandCards(allCards);
    const layout = computeLayout();
    const cardsPerPage = layout.rows * layout.columns;
    const settingGroups: { title: string; settings: SettingDefinition[] }[] = [
      {
        title: '📄 Параметры бумаги',
        settings: [
          { key: 'paper', label: 'Формат бумаги', type: 'select', options: Object.keys(PAPER_SIZES), getLabel: (v) => PAPER_SIZES[v]?.name || v },
          { key: 'customWidth', label: 'Ширина (мм)', type: 'number', condition: printSettings.paper === 'custom', min: 50, max: 600 },
          { key: 'customHeight', label: 'Высота (мм)', type: 'number', condition: printSettings.paper === 'custom', min: 50, max: 600 },
          { key: 'orientation', label: 'Ориентация', type: 'select', options: ['portrait', 'landscape'], getLabel: (v) => (v === 'portrait' ? 'Портрет' : 'Альбом') },
          { key: 'autoCenter', label: 'Центрировать блок карт', type: 'checkbox' },
          { key: 'marginTop', label: 'Отступ сверху (мм)', type: 'number', min: 0, max: 100 },
          { key: 'marginBottom', label: 'Отступ снизу (мм)', type: 'number', min: 0, max: 100 },
          { key: 'marginLeft', label: 'Отступ слева (мм)', type: 'number', min: 0, max: 100 },
          { key: 'marginRight', label: 'Отступ справа (мм)', type: 'number', min: 0, max: 100 },
        ],
      },
      {
        title: '🃏 Размеры карт',
        settings: [
          { key: 'scale', label: 'Масштаб', type: 'range', min: 0.5, max: 2, step: 0.01 },
          { key: 'cardWidth', label: 'Ширина карты (мм)', type: 'number', min: 40, max: 80 },
          { key: 'cardHeight', label: 'Высота карты (мм)', type: 'number', min: 60, max: 120 },
          { key: 'columns', label: 'Колонки', type: 'number', min: 1, max: 6 },
          { key: 'rows', label: 'Ряды', type: 'number', min: 1, max: 6 },
          { key: 'gapX', label: 'Промежуток по горизонтали (мм)', type: 'number', min: 0, max: 10 },
          { key: 'gapY', label: 'Промежуток по вертикали (мм)', type: 'number', min: 0, max: 10 },
          { key: 'borderCrop', label: 'Обрезка рамки (px)', type: 'number', min: 0, max: 50 },
          { key: 'bleed', label: 'Вылет (мм)', type: 'number', min: 0, max: 5 },
        ],
      },
      {
        title: '🎨 Вывод',
        settings: [
          { key: 'format', label: 'Формат вывода', type: 'select', options: ['pdf', 'png', 'jpg'], getLabel: (v) => v.toUpperCase() },
          { key: 'dpi', label: 'DPI', type: 'number', min: 72, max: 600, condition: printSettings.format !== 'pdf' },
          { key: 'quality', label: 'Качество', type: 'select', options: ['low', 'medium', 'high'], getLabel: (v) => (v === 'low' ? 'Низкое' : v === 'medium' ? 'Среднее' : 'Высокое') },
          { key: 'colorMode', label: 'Цветовой режим', type: 'select', options: ['color', 'grayscale'], getLabel: (v) => (v === 'color' ? 'Цветной' : 'Ч/Б') },
        ],
      },
      {
        title: '✂️ Дополнительно',
        settings: [
          { key: 'cropmarks', label: 'Добавить метки обрезки', type: 'checkbox' },
          { key: 'background', label: 'Цвет фона', type: 'color' },
          { key: 'faces', label: 'Стороны', type: 'select', options: ['all', 'front', 'back'], getLabel: (v) => (v === 'all' ? 'Все' : v === 'front' ? 'Только лицевая' : 'Только обратная') },
        ],
      },
    ];

    return (
      <div className="space-y-6">
        <div className="bg-white p-6 rounded-lg shadow-md">
          <h3 className="text-lg font-semibold mb-4">🖨️ Настройки печати</h3>

          <div className="mb-4 p-4 bg-blue-50 rounded-lg text-sm text-blue-800">
            Значения по умолчанию настроены на 100% размер карт, без обрезки и без промежутков. Карты будут по центру листа.
          </div>

          {settingGroups.map((group) => (
            <div key={group.title} className="mb-6">
              <h4 className="font-medium text-gray-700 mb-3">{group.title}</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {group.settings.map((s) => {
                  if (s.condition === false) return null;
                  const value = printSettings[s.key];

                  return (
                    <div key={s.key} className="space-y-1">
                      <label className="block text-sm font-medium text-gray-600">{s.label}</label>
                      {s.type === 'select' && s.options && (
                        <select
                          value={String(value)}
                          onChange={(e) => setPrintSettings({ ...printSettings, [s.key]: e.target.value as PrintSettings[keyof PrintSettings] })}
                          className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                        >
                          {s.options.map((opt) => (
                            <option key={opt} value={opt}>
                              {s.getLabel ? s.getLabel(opt) : opt}
                            </option>
                          ))}
                        </select>
                      )}
                      {s.type === 'number' && (
                        <input
                          type="number"
                          value={value as number}
                          onChange={(e) => setPrintSettings({ ...printSettings, [s.key]: parseFloat(e.target.value) || 0 })}
                          min={s.min}
                          max={s.max}
                          step={s.min && s.min < 1 ? 0.1 : 1}
                          className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                        />
                      )}
                      {s.type === 'range' && (
                        <div className="flex items-center gap-2">
                          <input
                            type="range"
                            value={value as number}
                            onChange={(e) => setPrintSettings({ ...printSettings, [s.key]: parseFloat(e.target.value) })}
                            min={s.min}
                            max={s.max}
                            step={s.step || 1}
                            className="flex-1"
                          />
                          <span className="text-sm text-gray-600 w-12 text-right">{value}</span>
                        </div>
                      )}
                      {s.type === 'checkbox' && (
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={Boolean(value)}
                            onChange={(e) => setPrintSettings({ ...printSettings, [s.key]: e.target.checked })}
                            className="rounded text-blue-500"
                          />
                        </label>
                      )}
                      {s.type === 'color' && (
                        <div className="flex gap-2">
                          <input
                            type="color"
                            value={value as string}
                            onChange={(e) => setPrintSettings({ ...printSettings, [s.key]: e.target.value })}
                            className="h-10 w-14 rounded cursor-pointer"
                          />
                          <input
                            type="text"
                            value={value as string}
                            onChange={(e) => setPrintSettings({ ...printSettings, [s.key]: e.target.value })}
                            className="flex-1 px-3 py-2 border rounded-lg text-sm font-mono"
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          <button
            onClick={() => setShowPreview(!showPreview)}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 flex items-center gap-2"
          >
            <ImageIcon className="w-4 h-4" />
            {showPreview ? 'Скрыть превью' : 'Показать превью'}
          </button>
        </div>

        {showPreview && (
          <div className="bg-white p-6 rounded-lg shadow-md">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
              <div className="flex items-center gap-4">
                <span className="text-sm font-medium">Масштаб:</span>
                <button onClick={() => setPreviewZoom((z) => Math.max(0.1, z - 0.1))} className="p-1 bg-gray-200 rounded hover:bg-gray-300">
                  <ZoomOut className="w-4 h-4" />
                </button>
                <span className="text-sm w-12 text-center">{(previewZoom * 100).toFixed(0)}%</span>
                <button onClick={() => setPreviewZoom((z) => Math.min(1, z + 0.1))} className="p-1 bg-gray-200 rounded hover:bg-gray-300">
                  <ZoomIn className="w-4 h-4" />
                </button>
              </div>
              <div className="text-sm text-gray-600">
                Карт на странице: {cardsPerPage} | Страниц: {Math.ceil(expandedCards.length / cardsPerPage) || 1}
              </div>
            </div>

            <div className="overflow-auto border rounded-lg">
              <div
                ref={previewRef}
                className="relative bg-white"
                style={{
                  width: `${layout.pageWidth}mm`,
                  height: `${layout.pageHeight}mm`,
                  backgroundColor: printSettings.background,
                  transform: `scale(${previewZoom})`,
                  transformOrigin: 'top left',
                }}
              >
                {expandedCards.slice(0, cardsPerPage).map((card, index) => {
                  const row = Math.floor(index / layout.columns);
                  const col = index % layout.columns;
                  const x = layout.marginLeft + col * (layout.cardWidth + layout.gapX);
                  const y = layout.marginTop + row * (layout.cardHeight + layout.gapY);
                  return (
                    <div
                      key={`${card.id}-${index}`}
                      className="absolute border border-gray-300"
                      style={{
                        width: `${layout.cardWidth}mm`,
                        height: `${layout.cardHeight}mm`,
                        left: `${x}mm`,
                        top: `${y}mm`,
                      }}
                    >
                      {getCardImageUrl(card, 'png') ? (
                        <img
                          src={getCardImageUrl(card, 'png')}
                          alt={card.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full bg-gray-300 flex items-center justify-center text-xs text-center p-1">{card.name}</div>
                      )}
                      {printSettings.cropmarks && (
                        <>
                          <div className="absolute -top-1 left-1/2 w-px h-2 bg-red-500 -translate-x-1/2" />
                          <div className="absolute -bottom-1 left-1/2 w-px h-2 bg-red-500 -translate-x-1/2" />
                          <div className="absolute top-1/2 -left-1 w-2 h-px bg-red-500 -translate-y-1/2" />
                          <div className="absolute top-1/2 -right-1 w-2 h-px bg-red-500 -translate-y-1/2" />
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderStep5 = () => {
    const totalCards = decklist.cards.reduce((a, c) => a + c.quantity, 0);
    const totalTokens = decklist.tokens.reduce((a, c) => a + c.quantity, 0);

    return (
      <div className="space-y-6">
        <div className="bg-white p-6 rounded-lg shadow-md text-center">
          <h3 className="text-lg font-semibold mb-4">📥 Экспорт</h3>

          <div className="grid grid-cols-2 gap-4 max-w-md mx-auto mb-8">
            <div className="p-4 bg-blue-50 rounded-lg">
              <p className="text-3xl font-bold text-blue-600">{totalCards}</p>
              <p className="text-sm text-gray-600">Карт</p>
            </div>
            <div className="p-4 bg-purple-50 rounded-lg">
              <p className="text-3xl font-bold text-purple-600">{totalTokens}</p>
              <p className="text-sm text-gray-600">Токенов</p>
            </div>
          </div>

          <div className="space-y-4 max-w-md mx-auto">
            <button
              onClick={printSettings.format === 'pdf' ? generatePDF : generateImage}
              disabled={progress.active || totalCards + totalTokens === 0}
              className="w-full px-6 py-4 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center justify-center gap-3 text-lg font-medium"
            >
              {progress.active ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileText className="w-5 h-5" />}
              {progress.active ? progress.message : `Скачать ${printSettings.format.toUpperCase()}`}
            </button>

            <button
              onClick={downloadDeckText}
              disabled={totalCards === 0}
              className="w-full px-6 py-4 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center justify-center gap-3 text-lg font-medium"
            >
              <Download className="w-5 h-5" />
              Скачать текстовый decklist
            </button>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-md">
          <h3 className="text-lg font-semibold mb-4">📋 Итоговый список</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 className="font-medium mb-2">Основная колода ({totalCards})</h4>
              <div className="max-h-64 overflow-y-auto border rounded">
                {decklist.cards.map((card, i) => (
                  <div key={i} className="text-sm py-2 px-3 border-b flex justify-between items-center">
                    <span>
                      {card.quantity}x {card.name}
                    </span>
                    <span className="text-gray-500 text-xs">
                      {card.set} #{card.collector_number}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h4 className="font-medium mb-2">Токены ({totalTokens})</h4>
              <div className="max-h-64 overflow-y-auto border rounded">
                {decklist.tokens.map((token, i) => (
                  <div key={i} className="text-sm py-2 px-3 border-b flex justify-between items-center">
                    <span>
                      {token.quantity}x {token.name}
                    </span>
                    <span className="text-gray-500 text-xs">{token.set}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white shadow-sm border-b sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <h1 className="text-2xl font-bold text-gray-900">🎴 MTG Proxy Builder</h1>
          <p className="text-sm text-gray-600">Создание прокси-карт Magic: The Gathering</p>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className="mb-8">
          <div className="flex items-center justify-between flex-wrap gap-2">
            {STEPS.map((step, idx) => (
              <React.Fragment key={step.id}>
                <button
                  onClick={() => setCurrentStep(step.id)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors text-sm ${
                    currentStep === step.id
                      ? 'bg-blue-500 text-white'
                      : currentStep > step.id
                      ? 'bg-green-100 text-green-700'
                      : 'bg-gray-200 text-gray-600'
                  }`}
                >
                  <step.icon className="w-4 h-4" />
                  <span className="hidden sm:inline font-medium">{step.title}</span>
                </button>
                {idx < STEPS.length - 1 && <span className="text-gray-400 hidden sm:block">→</span>}
              </React.Fragment>
            ))}
          </div>
        </div>

        <div className="mb-6">
          {currentStep === 1 && renderStep1()}
          {currentStep === 2 && renderStep2()}
          {currentStep === 3 && renderStep3()}
          {currentStep === 4 && renderStep4()}
          {currentStep === 5 && renderStep5()}
        </div>

        <div className="flex justify-between">
          <button
            onClick={() => setCurrentStep(Math.max(1, currentStep - 1))}
            disabled={currentStep === 1}
            className="flex items-center gap-2 px-6 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            ← Назад
          </button>
          <button
            onClick={() => setCurrentStep(Math.min(5, currentStep + 1))}
            disabled={currentStep === 5}
            className="flex items-center gap-2 px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            Далее →
          </button>
        </div>
      </main>

      {selectedCard && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-2xl w-full p-6 max-h-screen overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold">{selectedCard.name}</h3>
              <button onClick={() => setSelectedCard(null)} className="p-2 hover:bg-gray-100 rounded-full">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex flex-col md:flex-row gap-6">
              <div className="md:w-1/2">
                {getCardImageUrl(selectedCard, 'large') ? (
                  <img src={getCardImageUrl(selectedCard, 'large')} alt={selectedCard.name} className="w-full rounded-lg shadow-lg" />
                ) : (
                  <div className="aspect-[2.5/3.5] bg-gray-200 rounded-lg flex items-center justify-center">
                    <span className="text-gray-400">Нет изображения</span>
                  </div>
                )}
              </div>
              <div className="md:w-1/2 space-y-3">
                <p className="text-gray-600">
                  {selectedCard.set?.toUpperCase()} #{selectedCard.collector_number}
                </p>
                {selectedCard.type_line && <p className="text-sm text-gray-500">{selectedCard.type_line}</p>}
                {selectedCard.oracle_text && (
                  <div className="text-sm bg-gray-100 p-3 rounded whitespace-pre-line">{selectedCard.oracle_text}</div>
                )}
                <div className="pt-4 border-t space-y-2">
                  <p className="text-sm">
                    <span className="font-medium">Кол-во:</span> {selectedCard.quantity}
                  </p>
                  <p className="text-sm">
                    <span className="font-medium">Рамка:</span> {selectedCard.border_color}
                  </p>
                  <p className="text-sm">
                    <span className="font-medium">Фрейм:</span> {selectedCard.frame}
                  </p>
                  <p className="text-sm">
                    <span className="font-medium">High Res:</span> {selectedCard.highres_image ? '✅ Да' : '❌ Нет'}
                  </p>
                  <p className="text-sm">
                    <span className="font-medium">Цифровая:</span> {selectedCard.digital ? '❌ Да' : '✅ Нет'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {renderProgressBar()}
    </div>
  );
}
