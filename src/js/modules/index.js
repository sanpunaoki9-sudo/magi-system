// 丸タブごとのパネルの中身。ここにないタブは「COMING NEXT」の表示になる
import { createSystemModule } from './system.js';
import { createNewsModule } from './news.js';
import { createRankingModule } from './ranking.js';
import { createGraphModule } from './graph.js';
import { createLaunchModule } from './launch.js';
import { createCommandModule } from './command.js';
import { createAgentsModule } from './agents.js';
import { createQuotaModule } from './quota.js';
import { createSettingsModule } from './settings.js';

export function createModules(oz) {
  return {
    system: createSystemModule(oz),
    news: createNewsModule(oz),
    ranking: createRankingModule(oz),
    graph: createGraphModule(oz),
    launch: createLaunchModule(oz),
    command: createCommandModule(oz),
    agents: createAgentsModule(oz),
    quota: createQuotaModule(oz),
    settings: createSettingsModule(oz),
  };
}
