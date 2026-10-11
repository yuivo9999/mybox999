// Media taxonomy and classification

export const MEDIA_TYPE = Object.freeze({
  MOVIE: 'movie',
  TV: 'tv',
  VARIETY: 'variety',
});

export const MEDIA_TAXONOMY = Object.freeze({
  movie: [
    { id: 'drama', label: '剧情片' },
    { id: 'sci-fi', label: '科幻片' },
    { id: 'romance', label: '爱情片' },
    { id: 'action', label: '动作片' },
    { id: 'thriller', label: '惊悚片' },
    { id: 'animation', label: '动画电影片' },
    { id: 'comedy', label: '喜剧片' },
    { id: 'war', label: '战争片' },
  ],
  tv: [
    { id: 'china', label: '国产剧' },
    { id: 'japan', label: '日剧' },
    { id: 'korea', label: '韩剧' },
    { id: 'usa', label: '美剧' },
    { id: 'uk', label: '英剧' },
    { id: 'thailand', label: '泰剧' },
    { id: 'other', label: '其他剧' },
  ],
  variety: [
    { id: 'china', label: '国产综艺' },
    { id: 'japan', label: '日本综艺' },
    { id: 'korea', label: '韩国综艺' },
    { id: 'usa', label: '美国综艺' },
    { id: 'other', label: '其他综艺' },
  ],
});

const labelMap = Object.fromEntries(
  Object.entries(MEDIA_TAXONOMY).flatMap(([type, items]) => items.map(item => [`${type}:${item.id}`, item.label])),
);

function text(...values) {
  return values.filter(value => value != null).map(value => String(value).trim().toLowerCase()).join(' ');
}

const TYPE_ALIASES = {
  movie: ['movie', 'movies', 'film', 'films', 'vod', '电影', '影片', '电影片'],
  tv: ['tv', 'series', 'serial', '电视剧', '连续剧', '剧集', '电视'],
  variety: ['variety', 'show', 'shows', '综艺', '真人秀', '脱口秀', '娱乐节目'],
};

function includesAlias(value, aliases) {
  const normalized = text(value);
  return aliases.some(alias => normalized === alias || normalized.includes(alias));
}

function hasAny(value, keywords) {
  return keywords.some(keyword => value.includes(keyword));
}

export function classifyMedia({ type = '', category = '', region = '', title = '', episodes = [] } = {}) {
  const raw = text(type, category, region, title);
  const typeText = text(type);
  let mediaType;

  if (includesAlias(typeText, TYPE_ALIASES.variety)) mediaType = MEDIA_TYPE.VARIETY;
  else if (includesAlias(typeText, TYPE_ALIASES.tv)) mediaType = MEDIA_TYPE.TV;
  else if (includesAlias(typeText, TYPE_ALIASES.movie)) mediaType = MEDIA_TYPE.MOVIE;
  else if (episodes.length > 1 && !hasAny(raw, ['综艺', '真人秀', '脱口秀', 'variety'])) mediaType = MEDIA_TYPE.TV;
  else if (hasAny(raw, ['综艺', '真人秀', '脱口秀', 'variety', '日综', '韩综', '美综', '国产综艺'])) mediaType = MEDIA_TYPE.VARIETY;
  else if (hasAny(raw, ['电视剧', '连续剧', '剧集', 'tv剧', '日剧', '韩剧', '美剧', '英剧', '泰剧', '国产剧'])) mediaType = MEDIA_TYPE.TV;
  else if (hasAny(raw, ['电视剧', '连续剧', '剧集', 'tv剧', '日剧', '韩剧', '美剧', '英剧', '泰剧', '国产剧'])) mediaType = MEDIA_TYPE.TV;
  else if (hasAny(raw, ['电影', '影片', '电影片', '科幻', '动作片', '爱情片', '战争片', '动画电影', '喜剧片', '惊悚片'])) mediaType = MEDIA_TYPE.MOVIE;
  else mediaType = MEDIA_TYPE.MOVIE;

  const ids = [];
  const add = id => { if (!ids.includes(id)) ids.push(id); };

  if (mediaType === MEDIA_TYPE.MOVIE) {
    if (hasAny(raw, ['剧情', 'drama'])) add('drama');
    if (hasAny(raw, ['科幻', 'sci-fi', 'scifi'])) add('sci-fi');
    if (hasAny(raw, ['爱情', 'romance'])) add('romance');
    if (hasAny(raw, ['动作', 'action'])) add('action');
    if (hasAny(raw, ['惊悚', 'thriller', '悬疑惊悚'])) add('thriller');
    if (hasAny(raw, ['动画电影', '动画片', 'animation', '动漫电影'])) add('animation');
    if (hasAny(raw, ['喜剧', 'comedy'])) add('comedy');
    if (hasAny(raw, ['战争', 'war'])) add('war');
  } else if (mediaType === MEDIA_TYPE.TV) {
    if (hasAny(raw, ['国产', '中国大陆', '中国内地', '大陆剧', 'china'])) add('china');
    else if (hasAny(raw, ['日本', '日剧', 'japan'])) add('japan');
    else if (hasAny(raw, ['韩国', '韩剧', 'korea'])) add('korea');
    else if (hasAny(raw, ['美国', '美剧', 'usa', 'us剧'])) add('usa');
    else if (hasAny(raw, ['英国', '英剧', 'uk'])) add('uk');
    else if (hasAny(raw, ['泰国', '泰剧', 'thailand'])) add('thailand');
    else add('other');
  } else {
    if (hasAny(raw, ['国产', '中国大陆', '中国内地', 'china'])) add('china');
    else if (hasAny(raw, ['日本', '日综', '日本综艺', 'japan'])) add('japan');
    else if (hasAny(raw, ['韩国', '韩综', '韩国综艺', 'korea'])) add('korea');
    else if (hasAny(raw, ['美国', '美综', '美国综艺', 'usa'])) add('usa');
    else add('other');
  }

  return {
    mediaType,
    categoryIds: ids,
    categoryLabels: ids.map(id => labelMap[`${mediaType}:${id}`]).filter(Boolean),
  };
}

export function getCategoryLabel(mediaType, categoryId) {
  return labelMap[`${mediaType}:${categoryId}`] ?? categoryId;
}

export function getTaxonomy(mediaType) {
  return MEDIA_TAXONOMY[mediaType] ? [...MEDIA_TAXONOMY[mediaType]] : [];
}

export function getCategoryIdByLabel(mediaType, label) {
  return MEDIA_TAXONOMY[mediaType]?.find(item => item.label === label)?.id ?? '';
}


// Category matching helpers

export function moviesForCategory(movies = [], category) {
  if (!category || category === '全部' || category?.id === 'all' || category?.name === '全部') {
    return movies;
  }
  const catId = String(category?.id ?? '').trim();
  const catName = String(category?.name ?? category ?? '').trim().toLowerCase();

  return (movies ?? []).filter(movie => {
    // 1. Direct ID match
    if (catId && catId !== 'all') {
      if (String(movie.sourceCategoryId ?? '') === catId) return true;
      if ((movie.sourceCategoryIds ?? []).map(String).includes(catId)) return true;
      if ((movie.categoryIds ?? []).map(String).includes(catId)) return true;
    }

    // 2. Exact category name match
    const mCat = String(movie.category ?? '').trim().toLowerCase();
    const mSourceCat = String(movie.sourceCategoryName ?? '').trim().toLowerCase();
    const mCatNames = (movie.sourceCategoryNames ?? []).map(s => String(s).trim().toLowerCase());
    const mCatLabels = (movie.categoryLabels ?? []).map(s => String(s).trim().toLowerCase());

    if (catName) {
      if (mCat === catName || mSourceCat === catName) return true;
      if (mCatNames.includes(catName) || mCatLabels.includes(catName)) return true;

      // 3. Category family mapping for Chinese VOD taxonomy
      if (catName === '电影' && (
        movie.mediaType === 'movie' ||
        /片$/.test(mCat) ||
        /动作|爱情|喜剧|科幻|恐怖|剧情|战争|惊悚|悬疑|犯罪|冒险|灾难|奇幻/.test(mCat)
      )) return true;

      if ((catName === '电视剧' || catName === '剧集') && (
        movie.mediaType === 'series' ||
        /剧$/.test(mCat) ||
        /国产|内地|香港|韩剧|日剧|欧美|台湾|海外|连续剧/.test(mCat)
      )) return true;

      if (catName === '动漫' && (
        movie.mediaType === 'anime' ||
        /动漫|动画/.test(mCat)
      )) return true;

      if (catName === '综艺' && (
        movie.mediaType === 'variety' ||
        /综艺|真人秀|脱口秀|选秀/.test(mCat)
      )) return true;

      if (catName === '短剧' && (
        movie.mediaType === 'short-drama' ||
        /短剧|爽剧|现代都市|古装仙侠|反转爽剧|脑洞悬疑|都市/.test(mCat)
      )) return true;

      if (mCat.includes(catName) || catName.includes(mCat)) return true;
    }

    return false;
  });
}


// Continuous catalog dataset and item generation

/**
 * 持续加载服务 (Continuous Category Loading Service)
 * 支持同一类别源源不断“持续加载”全新、不重复内容
 * 严格去重 (标题、ID、关键词多维度去重)，40个之后支持分页
 */

const CATEGORY_LIBRARY = {
  电影: [
    { title: '流浪地球2', year: '2023', region: '中国大陆', rating: '8.3', genre: '科幻片', updateInfo: '4K超清国语', actors: ['吴京', '刘德华'], desc: '太阳即将毁灭，人类开启流浪地球时代寻找新家园。' },
    { title: '封神第一部：朝歌风云', year: '2023', region: '中国大陆', rating: '7.8', genre: '动作片', updateInfo: '4K臻彩画质', actors: ['费翔', '李雪健'], desc: '商王殷寿暴虐无道引发天谴，昆仑仙人姜子牙携封神榜下山。' },
    { title: '星际穿越', year: '2014', region: '欧美', rating: '9.4', genre: '科幻片', updateInfo: 'IMAX 4K重置版', actors: ['马修·麦康纳', '安妮·海瑟薇'], desc: '探险家穿越宇宙深处神秘虫洞，为濒临绝境的人类寻找希望。' },
    { title: '奥本海默', year: '2023', region: '欧美', rating: '8.8', genre: '剧情片', updateInfo: '4K超清原声', actors: ['基里安·墨菲', '艾米莉·布朗特'], desc: '原子弹之父奥本海默波澜壮阔而饱受争议的一生。' },
    { title: '沙丘2', year: '2024', region: '欧美', rating: '8.4', genre: '科幻片', updateInfo: '4K原盘杜比视界', actors: ['提莫西·查拉梅', '赞达亚'], desc: '保罗·厄崔迪携弗雷曼人为惨遭灭门的厄崔迪家族复仇。' },
    { title: '热辣滚烫', year: '2024', region: '中国大陆', rating: '7.7', genre: '喜剧片', updateInfo: '4K超清国语', actors: ['贾玲', '雷佳音'], desc: '宅家多年的乐莹结识拳击教练，踏上拳台重拾人生自信。' },
    { title: '飞驰人生2', year: '2024', region: '中国大陆', rating: '7.6', genre: '喜剧片', updateInfo: '4K超清国语', actors: ['沈腾', '范丞丞'], desc: '落魄驾校教练张驰重组草台班子再战巴音布鲁克拉力赛。' },
    { title: '第二十条', year: '2024', region: '中国大陆', rating: '7.7', genre: '剧情片', updateInfo: '4K超清国语', actors: ['雷佳音', '马丽'], desc: '检察官韩明在法与情、情与理的漩涡中捍卫公平正义。' },
    { title: '消失的她', year: '2023', region: '中国大陆', rating: '7.4', genre: '悬疑片', updateInfo: '4K超清国语', actors: ['朱一龙', '倪妮'], desc: '妻子在海外离奇失踪，陌生女子突然冒充其妻子出现。' },
    { title: '长安三万里', year: '2023', region: '中国大陆', rating: '8.3', genre: '动画片', updateInfo: '4K国漫巅峰', actors: ['杨天翔', '宣晓鸣'], desc: '安史之乱爆发数年后，高适向监军太监回忆与李白的壮丽盛唐。' },
    { title: '孤注一掷', year: '2023', region: '中国大陆', rating: '7.3', genre: '犯罪片', updateInfo: '4K超清国语', actors: ['张艺兴', '金晨'], desc: '程序员与模特落入境外网络诈骗工厂的惊险真实犯罪剖析。' },
    { title: '三大队', year: '2023', region: '中国大陆', rating: '7.8', genre: '犯罪片', updateInfo: '4K超清国语', actors: ['张译', '李晨'], desc: '刑侦大队队长程兵带领同仁十二载风霜万里追凶。' },
    { title: '满江红', year: '2023', region: '中国大陆', rating: '7.2', genre: '悬疑片', updateInfo: '4K超清', actors: ['沈腾', '易烊千玺'], desc: '南宋绍兴年间，宰相秦桧率兵与金国会谈前夕的诡谲迷局。' },
    { title: '无名', year: '2023', region: '中国大陆', rating: '7.5', genre: '动作片', updateInfo: '4K超清', actors: ['梁朝伟', '王一博'], desc: '抗战时期隐秘战线中共地下党员冒死送出情报的惊心动魄故事。' },
    { title: '金手指', year: '2023', region: '香港', rating: '7.1', genre: '犯罪片', updateInfo: '4K粤语/国语', actors: ['梁朝伟', '刘德华'], desc: '上市公司嘉文集团在短短几年间从崛起到清盘的金融诈骗大案。' },
    { title: '潜行', year: '2023', region: '香港', rating: '7.0', genre: '犯罪片', updateInfo: '4K高码率', actors: ['刘德华', '林家栋'], desc: '隐蔽暗网毒品交易肆虐，警方展开生死反恐追击。' },
    { title: '年会不能停！', year: '2023', region: '中国大陆', rating: '8.1', genre: '喜剧片', updateInfo: '4K超清国语', actors: ['大鹏', '白客'], desc: '钳工胡建林阴差阳错调入集团总部，整顿职场的爆笑逆袭。' },
    { title: '涉过愤怒的海', year: '2023', region: '中国大陆', rating: '7.4', genre: '悬疑片', updateInfo: '4K超清', actors: ['黄渤', '周迅'], desc: '老金得知爱女身中多刀惨死，跨国追踪嫌疑人李苗苗的残酷复仇。' },
    { title: '坚如磐石', year: '2023', region: '中国大陆', rating: '7.1', genre: '犯罪片', updateInfo: '4K超清国语', actors: ['雷佳音', '张国立', '于和伟'], desc: '普通青年警察苏见明在调查一起爆炸案时掀开黑恶官商保护伞。' },
    { title: '深海', year: '2023', region: '中国大陆', rating: '7.3', genre: '动画片', updateInfo: '4K粒子水墨', actors: ['王亭文', '苏鑫'], desc: '现代少女参宿在神秘深海饭店展开梦幻而治愈的奇幻冒险。' },
    { title: '保你平安', year: '2023', region: '中国大陆', rating: '7.7', genre: '喜剧片', updateInfo: '4K超清', actors: ['大鹏', '李雪琴'], desc: '墓地销售魏平安为辟谣亡者名誉，踏上啼笑皆非的辟谣之路。' },
    { title: '熊出没·逆转时空', year: '2024', region: '中国大陆', rating: '7.4', genre: '动画片', updateInfo: '4K超清', actors: ['谭笑', '张秉君'], desc: '光头强获得重新选择人生的机会，穿梭时空拯救森林伙伴。' },
    { title: '我们一起摇太阳', year: '2024', region: '中国大陆', rating: '7.9', genre: '剧情片', updateInfo: '4K温暖治愈', actors: ['彭昱畅', '李庚希'], desc: '当“没头脑”吕途遇上“不高兴”凌敏，绝境中彼此救赎的感人篇章。' },
    { title: '红海行动', year: '2018', region: '中国大陆', rating: '8.3', genre: '动作片', updateInfo: '4K杜比全景声', actors: ['张译', '黄景瑜'], desc: '中国海军蛟龙突击队临危受命远赴海外撤侨、粉碎恐袭阴谋。' },
    { title: '战狼2', year: '2017', region: '中国大陆', rating: '7.6', genre: '动作片', updateInfo: '4K超清', actors: ['吴京', '弗兰克·格里罗'], desc: '脱下军装的冷锋在非洲战乱国家孤身营救同胞与难民。' },
    { title: '我不是药神', year: '2018', region: '中国大陆', rating: '9.0', genre: '剧情片', updateInfo: '4K超清', actors: ['徐峥', '周一围'], desc: '神油店老板程勇偶然成为印度廉价仿制抗癌药代理人的现实救赎。' },
    { title: '头号玩家', year: '2018', region: '欧美', rating: '8.7', genre: '科幻片', updateInfo: '4K超清原声', actors: ['泰伊·谢里丹', '奥利维亚·库克'], desc: '未来世界人们沉迷于虚拟绿洲，少年韦德踏上追寻创始人三把钥匙。' },
    { title: '盗梦空间', year: '2010', region: '欧美', rating: '9.3', genre: '科幻片', updateInfo: '4K超清原声', actors: ['莱昂纳多·迪卡普里奥'], desc: '造梦师道姆·柯布带领团队潜入他人梦境植入想法的层层迷宫。' },
    { title: '阿凡达：水之道', year: '2022', region: '欧美', rating: '7.9', genre: '科幻片', updateInfo: '4K高帧率', actors: ['萨姆·沃辛顿', '佐伊·索尔达娜'], desc: '萨利一家离开森林前往潘多拉星球礁石海洋部落的史诗冒险。' },
    { title: '瞬息全宇宙', year: '2022', region: '欧美', rating: '7.6', genre: '科幻片', updateInfo: '4K超清奥斯卡大奖', actors: ['杨紫琼', '关继威'], desc: '中年华裔妇女秀莲在无数多元平行宇宙中穿梭，拯救家庭与世界。' },
    { title: '蜘蛛侠：平行宇宙', year: '2018', region: '欧美', rating: '8.7', genre: '动画片', updateInfo: '4K绚丽视效', actors: ['沙梅克·摩尔'], desc: '普通高中生迈尔斯意外获得超能力，与多重宇宙的蜘蛛侠并肩作战。' },
    { title: '楚门的世界', year: '1998', region: '欧美', rating: '9.3', genre: '剧情片', updateInfo: '4K重置版', actors: ['金·凯瑞'], desc: '楚门三十年来生活在由全球二十四小时直播的巨大摄影棚中。' },
    { title: '狂暴巨兽', year: '2018', region: '欧美', rating: '7.1', genre: '动作片', updateInfo: '4K杜比视界', actors: ['道恩·强森'], desc: '基因突变巨兽席卷城市，灵长类动物学家拯救世界与大猩猩。' },
    { title: '速度与激情10', year: '2023', region: '欧美', rating: '7.0', genre: '动作片', updateInfo: '4K超清原声', actors: ['范·迪塞尔', '杰森·莫玛'], desc: '飞车家族面临史上最危险复仇者但丁的狂暴反扑。' },
    { title: '碟中谍7：致命清算', year: '2023', region: '欧美', rating: '7.7', genre: '动作片', updateInfo: '4K超清', actors: ['汤姆·克鲁斯'], desc: '伊森·亨特与IMF小组对抗企图掌控全球全人类的超级AI。' },
    { title: '疯狂的麦克斯：狂暴之路', year: '2015', region: '欧美', rating: '8.7', genre: '动作片', updateInfo: '4K重爆热血', actors: ['汤姆·哈迪', '查理兹·塞隆'], desc: '末世荒漠公路狂飙逃亡，废土狂热与救赎的狂暴交响乐。' },
    { title: '让子弹飞', year: '2010', region: '中国大陆', rating: '9.0', genre: '喜剧片', updateInfo: '4K超清', actors: ['姜文', '葛优', '周润发'], desc: '悍匪张牧之摇身一变成县长入驻鹅城，与恶霸黄四郎斗智斗勇。' },
    { title: '大话西游之大圣娶亲', year: '1995', region: '香港', rating: '9.2', genre: '喜剧片', updateInfo: '4K修复版', actors: ['周星驰', '朱茵'], desc: '至尊宝借月光宝盒回到五百年前，与紫霞仙子刻骨铭心的宿命爱恋。' },
    { title: '无间道', year: '2002', region: '香港', rating: '9.3', genre: '犯罪片', updateInfo: '4K修复国粤双语', actors: ['梁朝伟', '刘德华'], desc: '卧底警察与黑道卧底在双向隐蔽战线中的身份挣扎与绝命博弈。' },
    { title: '英雄本色', year: '1986', region: '香港', rating: '8.8', genre: '动作片', updateInfo: '4K修复版', actors: ['狄龙', '张国荣', '周润发'], desc: '宋子豪、小马哥与宋子杰兄弟三人江湖恩怨与热血情义。' },
    { title: '功夫', year: '2004', region: '香港', rating: '8.8', genre: '动作片', updateInfo: '4K修复版', actors: ['周星驰', '元华', '元秋'], desc: '小混混阿星梦想成为黑帮大哥，却意外激发绝世武功潜能。' },
    { title: '少林足球', year: '2001', region: '香港', rating: '8.2', genre: '喜剧片', updateInfo: '4K修复版', actors: ['周星驰', '赵薇', '吴孟达'], desc: '阿星集结失意少林师兄弟，将传统中国功夫融进现代足球比赛。' },
  ],
  电视剧: [
    { title: '狂飙', year: '2023', region: '中国大陆', rating: '8.5', genre: '大陆剧', updateInfo: '全39集完结', actors: ['张译', '张颂文'], desc: '京海市刑警安欣与黑恶势力代表高启强长达二十年的正邪较量。' },
    { title: '三体', year: '2023', region: '中国大陆', rating: '8.7', genre: '大陆剧', updateInfo: '全30集完结', actors: ['张鲁一', '于和伟'], desc: '纳米科学家汪淼与刑警史强揭开三体文明的神秘面纱。' },
    { title: '繁花', year: '2023', region: '中国大陆', rating: '8.7', genre: '大陆剧', updateInfo: '全30集完结', actors: ['胡歌', '马伊琍'], desc: '九十年代初上海黄河路商海浮沉，阿宝奋斗成为宝总的传奇人生。' },
    { title: '漫长的季节', year: '2023', region: '中国大陆', rating: '9.4', genre: '大陆剧', updateInfo: '全12集完结', actors: ['范伟', '秦昊'], desc: '桦林跨越近二十年的碎尸悬案与老东北工人的时代挽歌。' },
    { title: '庆余年第二季', year: '2024', region: '中国大陆', rating: '8.1', genre: '古装剧', updateInfo: '全36集完结', actors: ['张若昀', '李沁', '陈道明'], desc: '范闲死里逃生重返京都，直面朝堂更险恶的风云权谋争夺。' },
    { title: '大江大河之岁月如歌', year: '2024', region: '中国大陆', rating: '8.0', genre: '大陆剧', updateInfo: '全33集完结', actors: ['王凯', '杨烁'], desc: '宋运辉、雷东宝等人在改革开放浪潮中拼搏前行的奋斗篇章。' },
    { title: '南来北往', year: '2024', region: '中国大陆', rating: '7.8', genre: '大陆剧', updateInfo: '全39集完结', actors: ['白敬亭', '丁勇岱'], desc: '二十世纪七十年代末宁阳开往哈尔滨的蒸汽火车上乘警师徒故事。' },
    { title: '追风者', year: '2024', region: '中国大陆', rating: '8.0', genre: '谍战剧', updateInfo: '全38集完结', actors: ['王一博', '李沁', '王阳'], desc: '青年魏若来在时代动荡中经历金融战线考验，确立革命理想。' },
    { title: '我的阿勒泰', year: '2024', region: '中国大陆', rating: '8.9', genre: '大陆剧', updateInfo: '全8集完结 · 4K治愈', actors: ['马伊琍', '周依然', '于适'], desc: '汉族少女李文秀在大草原找到心灵归宿与母女和解的诗意生活。' },
    { title: '觉醒年代', year: '2021', region: '中国大陆', rating: '9.3', genre: '大陆剧', updateInfo: '全43集完结', actors: ['于和伟', '张桐'], desc: '再现新文化运动到中国共产党建立这段波澜壮阔的厚重历史。' },
    { title: '人世间', year: '2022', region: '中国大陆', rating: '8.4', genre: '大陆剧', updateInfo: '全58集完结', actors: ['雷佳音', '辛柏青', '宋佳'], desc: '北方城市棚户区“光字片”周家三兄妹五十年的跌宕命运。' },
    { title: '隐秘的角落', year: '2020', region: '中国大陆', rating: '8.8', genre: '悬疑剧', updateInfo: '全12集完结', actors: ['秦昊', '王景春'], desc: '沿海小城三个少年在景区游玩意外录下谋杀案引发的风暴。' },
    { title: '琅琊榜', year: '2015', region: '中国大陆', rating: '9.4', genre: '古装剧', updateInfo: '全54集完结', actors: ['胡歌', '刘涛', '王凯'], desc: '梅长苏化身麒麟才子重返帝都，平反昭雪十二年前赤焰军冤案。' },
    { title: '父母爱情', year: '2014', region: '中国大陆', rating: '9.4', genre: '大陆剧', updateInfo: '全44集完结', actors: ['郭涛', '梅婷'], desc: '海军军官江德福与资本家小姐安杰携手走过五十年的温暖相伴。' },
    { title: '士兵突击', year: '2006', region: '中国大陆', rating: '9.5', genre: '军旅剧', updateInfo: '全30集完结', actors: ['王宝强', '陈思诚', '张译'], desc: '农村青年许三多“不抛弃，不放弃”成长为优秀特种兵的励志传奇。' },
    { title: '武林外传', year: '2006', region: '中国大陆', rating: '9.6', genre: '古装喜剧', updateInfo: '全80集完结', actors: ['闫妮', '姚晨', '沙溢'], desc: '七侠镇同福客栈里掌柜佟湘玉与伙计们的欢声笑语江湖生活。' },
    { title: '亮剑', year: '2005', region: '中国大陆', rating: '9.5', genre: '战争剧', updateInfo: '全30集完结', actors: ['李幼斌', '何政军'], desc: '李云龙率领独立团在抗日战争和解放战争中敢打硬仗的亮剑精神。' },
    { title: '潜伏', year: '2009', region: '中国大陆', rating: '9.4', genre: '谍战剧', updateInfo: '全30集完结', actors: ['孙红雷', '姚晨'], desc: '国民党保密局天津站特务头子眼皮底下的中共情报人员余则成。' },
  ],
  动漫: [
    { title: '凡人修仙传', year: '2023', region: '中国大陆', rating: '8.9', genre: '国产动漫', updateInfo: '每周日更新 · 4K超清', actors: [], desc: '山村穷小子韩立谨慎坚毅在修仙界一步步登顶的仙途。' },
    { title: '完美世界', year: '2023', region: '中国大陆', rating: '8.6', genre: '国产动漫', updateInfo: '每周五更新 · 4K巅峰', actors: [], desc: '大荒少年石昊为修道而生，斩尽日月星辰战八荒。' },
    { title: '斗罗大陆', year: '2023', region: '中国大陆', rating: '8.4', genre: '国产动漫', updateInfo: '全250集完结', actors: [], desc: '唐三穿越至斗罗大陆，重铸唐门辉煌成神之路。' },
    { title: '吞噬星空', year: '2023', region: '中国大陆', rating: '8.5', genre: '国产动漫', updateInfo: '每周二更新 · 4K科幻', actors: [], desc: '地球经历大涅槃时期，罗峰成为武者踏入浩瀚宇宙探险。' },
    { title: '仙逆', year: '2023', region: '中国大陆', rating: '8.8', genre: '国产动漫', updateInfo: '每周一更新 · 杀伐果断', actors: [], desc: '少年王林踏入修仙逆道，平生不求长生只求快意恩仇。' },
    { title: '遮天', year: '2023', region: '中国大陆', rating: '8.2', genre: '国产动漫', updateInfo: '每周三更新', actors: [], desc: '九龙拉棺降临泰山，叶凡踏上横渡星空的远古修仙长路。' },
    { title: '画江湖之不良人第六季', year: '2023', region: '中国大陆', rating: '9.5', genre: '国产动漫', updateInfo: '全12集完结 · 国漫封神', actors: [], desc: '李星云为天下苍生化身天暗星，在乱世棋局中破局重生。' },
    { title: '咒术回战第二季', year: '2023', region: '日本', rating: '9.0', genre: '日本动漫', updateInfo: '涉谷事变完结 · 4K超清', actors: [], desc: '五条悟与夏油杰的青春往事与激烈的涉谷决战。' },
    { title: '鬼灭之刃：柱训练篇', year: '2024', region: '日本', rating: '8.7', genre: '日本动漫', updateInfo: '全8集完结', actors: [], desc: '炭治郎与九柱展开魔鬼特训，迎接无限城终极决战。' },
    { title: '进击的巨人：最终季完结篇', year: '2023', region: '日本', rating: '9.3', genre: '日本动漫', updateInfo: '终章完结', actors: [], desc: '艾伦发动地鸣，调查兵团同伴阻止灭世的宿命终局。' },
    { title: '间谍过家家第二季', year: '2023', region: '日本', rating: '8.6', genre: '日本动漫', updateInfo: '全12集完结', actors: [], desc: '间谍父亲、杀手母亲与读心术女儿伪装家庭的爆笑日常。' },
    { title: '电锯人', year: '2022', region: '日本', rating: '8.3', genre: '日本动漫', updateInfo: '全12集完结', actors: [], desc: '少年电次与恶魔波奇塔融合成电锯恶魔的猎魔故事。' },
  ],
  综艺: [
    { title: '歌手2024', year: '2024', region: '中国大陆', rating: '8.2', genre: '大陆综艺', updateInfo: '全12期完结 · 全开麦直播', actors: ['那英', '凡希亚', '香缇莫'], desc: '中外顶级唱将无修音全开麦直播对决风潮。' },
    { title: '大侦探第九季', year: '2024', region: '中国大陆', rating: '8.6', genre: '大陆综艺', updateInfo: '全12案完结', actors: ['何炅', '张若昀', '大张伟'], desc: '明星玩家穿梭高能剧本杀案情，层层推理找出真相。' },
    { title: '种地吧第二季', year: '2024', region: '中国大陆', rating: '8.5', genre: '大陆综艺', updateInfo: '全50期完结', actors: ['十个勤天'], desc: '十位年轻人真实脚踏实地躬耕农田的青春奋斗纪录。' },
    { title: '喜人奇妙夜', year: '2024', region: '中国大陆', rating: '8.1', genre: '大陆综艺', updateInfo: '每周五更新 · 爆笑喜剧', actors: ['马东', '黄渤', '贾冰'], desc: '优秀青年喜剧人同台竞技带来原创Sketch喜剧盛宴。' },
    { title: '乘风2024', year: '2024', region: '中国大陆', rating: '7.5', genre: '大陆综艺', updateInfo: '全12期完结', actors: ['尚雯婕', '戚薇'], desc: '跨国女性嘉宾共同展示文化交流与舞台魅力蜕变。' },
    { title: '披荆斩棘第四季', year: '2024', region: '中国大陆', rating: '7.8', genre: '大陆综艺', updateInfo: '每周五六更新', actors: ['李克勤', '王铮亮'], desc: '滚烫哥哥携手炙热弟弟展开跨世代音乐舞台较量。' },
    { title: '脱口秀和Ta的朋友们', year: '2024', region: '中国大陆', rating: '8.3', genre: '大陆综艺', updateInfo: '每周二三更新', actors: ['张绍刚', '大张伟'], desc: '全新脱口秀演员齐聚一堂，用幽默消解生活烦恼。' },
    { title: '奔跑吧第八季', year: '2024', region: '中国大陆', rating: '7.4', genre: '大陆综艺', updateInfo: '全12期完结', actors: ['李晨', '郑恺', '沙溢', '周深'], desc: '跑男团走遍祖国大好河山，欢笑打卡文化胜地。' },
  ],
  短剧: [
    { title: '无双战神归来', year: '2024', region: '中国大陆', rating: '8.0', genre: '反转爽剧', updateInfo: '全80集完结', actors: [], desc: '隐忍五年的战神龙帅王者归来，惩奸除恶快意恩仇。' },
    { title: '我在古代当首富', year: '2024', region: '中国大陆', rating: '7.9', genre: '古装逆袭', updateInfo: '全72集完结', actors: [], desc: '现代商业奇才穿越回古代，靠连锁经商富甲天下。' },
    { title: '顾总，太太又惊艳全球了', year: '2024', region: '中国大陆', rating: '7.8', genre: '现代都市', updateInfo: '全88集完结', actors: [], desc: '真假千金回归打脸伪善渣男，携手傲娇总裁甜蜜逆袭。' },
    { title: '绝品狂医', year: '2024', region: '中国大陆', rating: '8.1', genre: '都市异能', updateInfo: '全90集完结', actors: [], desc: '少年习得古武医术，悬壶济世救死扶伤横扫都市豪门。' },
    { title: '长公主今日又想造反', year: '2024', region: '中国大陆', rating: '8.2', genre: '古装谋略', updateInfo: '全65集完结', actors: [], desc: '腹黑长公主步步为营智斗权臣，执掌江山如画。' },
    { title: '重生后我成了首富继承人', year: '2024', region: '中国大陆', rating: '7.7', genre: '都市逆袭', updateInfo: '全85集完结', actors: [], desc: '重回十年前抓住时代风口，打脸势利亲戚逆风翻盘。' },
    { title: '天降萌宝：妈咪超凶的', year: '2024', region: '中国大陆', rating: '7.6', genre: '甜宠萌宝', updateInfo: '全78集完结', actors: [], desc: '天才龙凤胎暗助落魄妈咪夺回属于自己的事业与幸福。' },
    { title: '万道龙皇', year: '2024', region: '中国大陆', rating: '8.3', genre: '玄幻修仙', updateInfo: '全100集完结', actors: [], desc: '身怀九龙神鼎，修至强功法踏灭诸天神魔。' },
  ],
};

const POSTER_PRESETS = [
  'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1534447677768-be436bb09401?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1517838277536-f5f99be501cd?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1589829545856-d10d557cf95f?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1578632767115-351597cf2477?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1550751827-4bd374c3f58b?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1533488765986-dfa2a9939acd?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1542204165-65bf26472b9b?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1514565131-fce0801e5785?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1508873696983-2df5293cb32f?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=600&q=80',
];

export function normalizeTitle(title) {
  return String(title || '')
    .trim()
    .toLowerCase()
    .replace(/[\s\-_:：·（）\(\)\[\]【】]/g, '');
}

const CATEGORY_STREAM_POOLS = {
  '电影': [
    { url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4', label: '科幻动作4K' },
    { url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4', label: '奇幻冒险超清' },
    { url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4', label: '动作大片专线' },
    { url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4', label: '极速蓝光' },
    { url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4', label: '欢乐院线' },
    { url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4', label: '超清原画' },
    { url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4', label: '震撼视界' },
    { url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4', label: '经典重置' },
  ],
  '电视剧': [
    { url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Subtled.mp4', label: '卫视高清' },
    { url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4', label: '全集蓝光' },
    { url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4', label: '极速同步' },
    { url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4', label: '4K超清线路' },
  ],
  '动漫': [
    { url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4', label: '国创动漫' },
    { url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4', label: '热血番剧' },
    { url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4', label: '新番极速' },
  ],
  '综艺': [
    { url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/WeAreGoingOnBullrun.mp4', label: '官方卫视' },
    { url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/WhatCarCanYouGetForAGrand.mp4', label: '现场原画' },
    { url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4', label: '欢乐加更' },
  ],
  '短剧': [
    { url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4', label: '全网热播' },
    { url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4', label: '爽剧极速' },
  ],
};

function getStreamForCategory(category, index = 0) {
  const list = CATEGORY_STREAM_POOLS[category] || CATEGORY_STREAM_POOLS['电影'];
  return list[index % list.length];
}

/**
 * 针对某个类别获取更多全新、不重复的内容
 * @param {string|object} category - 类别名称或分类对象，默认为“电影”
 * @param {Array} existingMovies - 当前已加载的所有影片，用于严格排重
 * @param {number} count - 每次加载的数量 (默认 12 部)
 * @returns {Array} 全新无重复的影视对象列表
 */
export function getMoreCategoryItems(category, existingMovies = [], count = 12) {
  const catName = typeof category === 'string'
    ? category
    : category?.name || '电影';

  const targetCategory = (catName === '全部' || catName === 'all') ? '电影' : catName;

  // 1. 建立现有内容的指纹集合 (以 ID 和规范化标题为准)
  const existingFingerprints = new Set();
  for (const m of existingMovies) {
    if (!m) continue;
    if (m.contentId) existingFingerprints.add(`id:${m.contentId}`);
    if (m.title) existingFingerprints.add(`t:${normalizeTitle(m.title)}`);
  }

  const pool = CATEGORY_LIBRARY[targetCategory] || CATEGORY_LIBRARY['电影'] || [];
  const freshItems = [];

  // 2. 首先从该类别的库中筛选出尚未加载的高质量内容
  for (let i = 0; i < pool.length; i++) {
    const raw = pool[i];
    const normT = normalizeTitle(raw.title);
    if (existingFingerprints.has(`t:${normT}`)) continue;

    const pseudoId = `cont_${targetCategory}_${i}_${normT.slice(0, 10)}`;
    if (existingFingerprints.has(`id:${pseudoId}`)) continue;

    const poster = POSTER_PRESETS[i % POSTER_PRESETS.length];
    const stream = getStreamForCategory(targetCategory, i);
    const epCount = targetCategory === '电视剧' ? 24 : targetCategory === '短剧' ? 80 : targetCategory === '动漫' ? 12 : targetCategory === '综艺' ? 12 : 1;

    const episodes = Array.from({ length: Math.min(epCount, 12) }, (_, epIdx) => ({
      episodeId: `${pseudoId}:ep${epIdx + 1}`,
      title: targetCategory === '电影' ? '正片 4K' : `第 ${epIdx + 1} 集`,
      episodeNumber: epIdx + 1,
      playbackCandidates: [
        { mediaUrl: stream.url, label: stream.label || '超清专线' },
      ],
    }));

    const item = {
      contentId: pseudoId,
      title: raw.title,
      category: targetCategory,
      sourceCategoryName: raw.genre || `${targetCategory}专区`,
      mediaType: targetCategory === '电影' ? 'movie' : targetCategory === '电视剧' ? 'series' : targetCategory === '动漫' ? 'anime' : targetCategory === '综艺' ? 'variety' : 'short-drama',
      year: raw.year || '2023',
      region: raw.region || '中国大陆',
      rating: raw.rating || '8.0',
      updateInfo: raw.updateInfo || '4K超清',
      remarks: raw.updateInfo || '4K超清',
      poster,
      backdrop: poster,
      description: raw.desc || `${raw.title} - 高清精彩好片。`,
      actors: raw.actors || [],
      playUrl: stream.url,
      episodes,
      popularity: Math.floor(70 + Math.random() * 28),
    };

    freshItems.push(item);
    existingFingerprints.add(`id:${pseudoId}`);
    existingFingerprints.add(`t:${normT}`);

    if (freshItems.length >= count) break;
  }

  // 3. 如果仍未填满 (用户多次点击，源源不断加载)，按该类别程序化生成高质量衍生佳作，确保绝对不重复
  if (freshItems.length < count) {
    const categoryAdjectives = targetCategory === '电影'
      ? ['重案', '风暴', '极限', '黑金', '火线', '致命', '破晓', '寒战', '迷雾', '谍影', '深空', '怒火', '赤子', '猎鹰', '狂飙', '逆战', '无间', '暗战']
      : targetCategory === '电视剧'
      ? ['大宋', '盛唐', '风起', '锦绣', '琅琊', '长安', '江山', '繁华', '人间', '星河', '云之', '岁月', '春风', '远山', '秋雨']
      : targetCategory === '动漫'
      ? ['绝世', '龙王', '万界', '神澜', '九星', '苍穹', '斗破', '逆天', '诛仙', '神墓', '剑道', '遮天', '仙武', '镇魂']
      : targetCategory === '综艺'
      ? ['向往的生活', '青春环游记', '极限挑战', '奔跑吧', '你好星期六', '王牌对王牌', '王牌新声', '天赐的声音', '中国好声音']
      : ['豪门', '战神', '千金', '神豪', '龙王', '绝世', '医圣', '狂婿', '天降', '无双'];

    const categoryNouns = targetCategory === '电影'
      ? ['行动', '追击', '风云', '审判', '突围', '营救', '对决', '终局', '法则', '纪元', '边缘', '档案', '黎明', '秘境']
      : targetCategory === '电视剧'
      ? ['传', '录', '记', '往事', '旧事', '春秋', '风华', '秘史', '图录', '长歌', '年华', '传奇']
      : targetCategory === '动漫'
      ? ['传', '纪元', '神王', '天尊', '圣王', '帝尊', '法则', '战纪', '之巅', '大帝', '传说']
      : targetCategory === '综艺'
      ? ['精编季', '特别季', '国际季', '新春版', '重温版', '加更版', '荣耀季', '巅峰版']
      : ['归来', '逆袭', '无双', '至尊', '觉醒', '天下', '再起', '风暴'];

    let seed = existingFingerprints.size + 1;
    let attempts = 0;
    while (freshItems.length < count && attempts < 200) {
      attempts++;
      seed++;
      const adj = categoryAdjectives[seed % categoryAdjectives.length];
      const noun = categoryNouns[(seed * 3) % categoryNouns.length];
      const genTitle = targetCategory === '综艺'
        ? `${adj} 第${(seed % 8) + 1}季`
        : `${adj}${noun}`;

      const normT = normalizeTitle(genTitle);
      if (existingFingerprints.has(`t:${normT}`)) continue;

      const pseudoId = `gen_${targetCategory}_${seed}_${Date.now()}`;
      const poster = POSTER_PRESETS[seed % POSTER_PRESETS.length];
      const stream = getStreamForCategory(targetCategory, seed);
      const epCount = targetCategory === '电视剧' ? 20 : targetCategory === '短剧' ? 60 : targetCategory === '动漫' ? 12 : targetCategory === '综艺' ? 12 : 1;

      const episodes = Array.from({ length: Math.min(epCount, 8) }, (_, epIdx) => ({
        episodeId: `${pseudoId}:ep${epIdx + 1}`,
        title: targetCategory === '电影' ? '正片 4K' : `第 ${epIdx + 1} 集`,
        episodeNumber: epIdx + 1,
        playbackCandidates: [
          { mediaUrl: stream.url, label: stream.label || '超清线路' },
        ],
      }));

      const item = {
        contentId: pseudoId,
        title: genTitle,
        category: targetCategory,
        sourceCategoryName: `${targetCategory}精选`,
        mediaType: targetCategory === '电影' ? 'movie' : targetCategory === '电视剧' ? 'series' : targetCategory === '动漫' ? 'anime' : targetCategory === '综艺' ? 'variety' : 'short-drama',
        year: String(2020 + (seed % 5)),
        region: (seed % 4 === 0) ? '欧美' : (seed % 4 === 1) ? '香港' : '中国大陆',
        rating: (7.2 + ((seed % 20) / 10)).toFixed(1),
        updateInfo: '4K超清',
        remarks: '4K超清',
        poster,
        backdrop: poster,
        description: `${genTitle} - 同一类别深度精选热门大作，精彩不间断呈现。`,
        actors: ['实力演员'],
        playUrl: stream.url,
        episodes,
        popularity: Math.floor(65 + Math.random() * 30),
      };

      freshItems.push(item);
      existingFingerprints.add(`id:${pseudoId}`);
      existingFingerprints.add(`t:${normT}`);
    }
  }

  return freshItems;
}


// Data-source contracts

export function createMovieDataSource({ fetchMovies }) {
  if (typeof fetchMovies !== 'function') throw new TypeError('fetchMovies must be a function');
  return Object.freeze({ fetchMovies });
}


export function createSearchDataSource({ search }) {
  if (typeof search !== 'function') throw new TypeError('search must be a function');
  return Object.freeze({ search });
}
