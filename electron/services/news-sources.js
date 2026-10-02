'use strict';

// AIニュースの情報元。type: feed = RSS/Atom、anthropic = ニュース一覧ページ、hf-papers = Hugging Face の注目論文API
// 情報元を増やすときは、ここに1行足すだけでよい。
const CATEGORIES = [
  { id: 'official', label: '公式' },
  { id: 'research', label: '研究' },
  { id: 'community', label: 'コミュニティ' },
  { id: 'media', label: 'メディア' },
  { id: 'japanese', label: '日本語' },
];

const SOURCES = [
  // 各社の公式発表
  { id: 'anthropic', name: 'Anthropic', category: 'official', type: 'anthropic', url: 'https://www.anthropic.com/news' },
  { id: 'openai', name: 'OpenAI', category: 'official', type: 'feed', url: 'https://openai.com/news/rss.xml' },
  { id: 'deepmind', name: 'Google DeepMind', category: 'official', type: 'feed', url: 'https://deepmind.google/blog/rss.xml' },
  { id: 'google-research', name: 'Google Research', category: 'official', type: 'feed', url: 'https://research.google/blog/rss/' },
  { id: 'microsoft-ai', name: 'Microsoft AI', category: 'official', type: 'feed', url: 'https://blogs.microsoft.com/ai/feed/' },
  { id: 'nvidia', name: 'NVIDIA', category: 'official', type: 'feed', url: 'https://blogs.nvidia.com/feed/' },
  { id: 'aws-ml', name: 'AWS Machine Learning', category: 'official', type: 'feed', url: 'https://aws.amazon.com/blogs/machine-learning/feed/' },
  { id: 'huggingface', name: 'Hugging Face', category: 'official', type: 'feed', url: 'https://huggingface.co/blog/feed.xml' },

  // 研究
  { id: 'hf-papers', name: 'HF Daily Papers', category: 'research', type: 'hf-papers', url: 'https://huggingface.co/api/daily_papers' },
  { id: 'arxiv-ai', name: 'arXiv cs.AI', category: 'research', type: 'feed', url: 'https://rss.arxiv.org/rss/cs.AI', limit: 15 },
  { id: 'arxiv-cl', name: 'arXiv cs.CL', category: 'research', type: 'feed', url: 'https://rss.arxiv.org/rss/cs.CL', limit: 15 },
  { id: 'arxiv-lg', name: 'arXiv cs.LG', category: 'research', type: 'feed', url: 'https://rss.arxiv.org/rss/cs.LG', limit: 15 },

  // 開発者コミュニティ
  { id: 'hn', name: 'Hacker News', category: 'community', type: 'feed', url: 'https://hnrss.org/newest?q=AI+OR+LLM+OR+GPT+OR+Claude+OR+Gemini+OR+OpenAI+OR+Anthropic&points=100' },
  { id: 'reddit-localllama', name: 'r/LocalLLaMA', category: 'community', type: 'feed', url: 'https://www.reddit.com/r/LocalLLaMA/top/.rss?t=day' },
  { id: 'reddit-ml', name: 'r/MachineLearning', category: 'community', type: 'feed', url: 'https://www.reddit.com/r/MachineLearning/top/.rss?t=day' },
  { id: 'simonwillison', name: 'Simon Willison', category: 'community', type: 'feed', url: 'https://simonwillison.net/atom/everything/' },

  // メディア
  { id: 'verge-ai', name: 'The Verge AI', category: 'media', type: 'feed', url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml' },
  { id: 'techcrunch-ai', name: 'TechCrunch AI', category: 'media', type: 'feed', url: 'https://techcrunch.com/category/artificial-intelligence/feed/' },

  // 日本語
  { id: 'itmedia-aiplus', name: 'ITmedia AI+', category: 'japanese', type: 'feed', url: 'https://rss.itmedia.co.jp/rss/2.0/aiplus.xml' },
  { id: 'publickey', name: 'Publickey', category: 'japanese', type: 'feed', url: 'https://www.publickey1.jp/atom.xml' },
  { id: 'zenn-ai', name: 'Zenn AI', category: 'japanese', type: 'feed', url: 'https://zenn.dev/topics/ai/feed' },
  { id: 'zenn-llm', name: 'Zenn LLM', category: 'japanese', type: 'feed', url: 'https://zenn.dev/topics/llm/feed' },
  { id: 'qiita-ai', name: 'Qiita AI', category: 'japanese', type: 'feed', url: 'https://qiita.com/tags/ai/feed' },
  { id: 'qiita-genai', name: 'Qiita 生成AI', category: 'japanese', type: 'feed', url: 'https://qiita.com/tags/%E7%94%9F%E6%88%90ai/feed' },
];

module.exports = { CATEGORIES, SOURCES };
