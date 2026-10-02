// 丸タブごとのパネルの中身。ここにないタブは「COMING NEXT」の表示になる
import { createSystemModule } from './system.js';
import { createNewsModule } from './news.js';
import { createRankingModule } from './ranking.js';
import { createGraphModule } from './graph.js';

export function createModules(oz) {
  return {
    system: createSystemModule(oz),
    news: createNewsModule(oz),
    ranking: createRankingModule(oz),
    graph: createGraphModule(oz),
  };
}
