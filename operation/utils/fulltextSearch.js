const utils = require("./utils");
const mysqlutil = require("./mysql");

function removeArrayDuplicate (array) {
    for(let i = 0; i < array.length; i++){
        for(let j = i + 1; j < array.length; j++){
            if(array[j] == array[i]){
                array.splice(j, 1);
                j -= 1;
            }
        }
    }
    return array;
}

function decomposeSearchPhrase (std_search_phrase) {
    this.generateKeywords = (phrase) => {
        let single_keys = phrase.split(/\s+/);
        let compound_keys = [];
        if(single_keys.length >= 2){
            for(let i = 0; i <= single_keys.length - 2; i++){
                let two_word_key = single_keys.slice(i, i + 2).join(" ");
                compound_keys.push(two_word_key);
            }
        };
        return {
            single_keys: removeArrayDuplicate(single_keys),
            compound_keys: removeArrayDuplicate(compound_keys)
        };
    }
    let unsigned_search = utils.removeVnCharacter(std_search_phrase);
    let strict_keys = this.generateKeywords(std_search_phrase);
    let ease_keys = this.generateKeywords(unsigned_search);
    let searchDecompsed = {
        strict_match_compound_words: strict_keys.compound_keys,
        strict_match_single_words: strict_keys.single_keys,
        ease_match_compound_words: ease_keys.compound_keys,
        ease_match_single_words: ease_keys.single_keys
    }
    return searchDecompsed;
}


function generateDictionaryKey ({ std_search_phrase, searchDictionary }) {
    try {
        let result = {
            strict_match_compound_words: [],
            strict_match_single_words: []
        };

        if (std_search_phrase && searchDictionary && searchDictionary.synonyms) {
            // The searchDictionary keywords need to be trimmed & transformed to uppercase
            // when it is loaded at the database connection phase. We will not trim and transform here
            // because it will costs calculation in every search request if we do so
            let unsigned_search = utils.removeVnCharacter(std_search_phrase);
            let synonyms = searchDictionary.synonyms;
            synonyms.forEach(group => {
                let isMatch = group.some(keyword => {
                    // A synonym keyword is considered to match with search_phrase when 1, It match exactly
                    // with it's VN characters OR 2, It is a compound word and match when remove VN characters
                    return (
                        std_search_phrase.indexOf(keyword) != -1 ||
                        (/\s/.test(keyword) && unsigned_search.indexOf(utils.removeVnCharacter(keyword)) != -1)
                    )
                })
                if (isMatch) {
                    group.forEach(keyword => {
                        if (/\s/.test(keyword)) {
                            result.strict_match_compound_words.push(keyword);
                        } else {
                            result.strict_match_single_words.push(keyword);
                        }
                    })
                }
            })
        }
        return result;
    } catch (err) {
        err.message += "\nSearch phrase and searchDictionary might be passed incorrectly!";
        throw err;
    }
}

function generateFulltextSqlSearchProductEntity ({ searchPhrase, searchDictionary }) {
    this.generateSql = (search_config) => {
        let {keywords, compare_mode, weight, prefix, postfix, table} = {...search_config};
        if(!compare_mode || !table || !keywords || keywords.length < 1) return null;
        let sql = [];
        keywords.forEach(key => {
            sql.push(
            `
            SELECT entity_id, ${weight} AS \`weight\`
            FROM \`ecommerce\`.\`${table}\` 
            WHERE attribute_id=\'name\' AND UPPER(value) ${compare_mode} \'${prefix}${mysqlutil.escapeQuotes(key)}${postfix}\'
            `
            );
        });
        sql = sql.join(" UNION ALL ");
        // there possibly null or empty sql returned, we will filter those out later
        return sql;
    }

    let sqlArr = [];
    if (searchPhrase && searchPhrase.trim().length > 0) {
        let std_search_phrase = searchPhrase.replace(/\(+|\)+|-+|\/+|\\+|\,+|\++|\t+|\n+/g, " ")
        .replace(/^\s+|\s+$/g, "").replace(/\s+/g, " ").toUpperCase();
        let searchDecompsed = decomposeSearchPhrase(std_search_phrase);
        if (searchDictionary && searchDictionary.synonyms) {
            let dictionaryKeys = generateDictionaryKey({ std_search_phrase, searchDictionary });
            searchDecompsed.strict_match_compound_words = [...searchDecompsed.strict_match_compound_words, ...dictionaryKeys.strict_match_compound_words];
            searchDecompsed.strict_match_compound_words = removeArrayDuplicate(searchDecompsed.strict_match_compound_words);
            searchDecompsed.strict_match_single_words = [...searchDecompsed.strict_match_single_words, ...dictionaryKeys.strict_match_single_words]
            searchDecompsed.strict_match_single_words = removeArrayDuplicate(searchDecompsed.strict_match_single_words)
        }
        let sql_1_weight = this.generateSql({
            keywords: searchDecompsed.ease_match_single_words,
            compare_mode: "LIKE",
            weight: 1,
            prefix: "%",
            postfix: "%",
            table: "product_eav_varchar"
        });
        let sql_2_weight = this.generateSql({
            keywords: searchDecompsed.ease_match_compound_words,
            compare_mode: "LIKE",
            weight: 2,
            prefix: "%",
            postfix: "%",
            table: "product_eav_varchar"
        });
        let sql_3_weight = this.generateSql({
            keywords: searchDecompsed.strict_match_single_words,
            compare_mode: "LIKE BINARY",
            weight: 3,
            prefix: "%",
            postfix: "%",
            table: "product_eav_varchar"
        });
        let sql_4_weight = this.generateSql({
            keywords: searchDecompsed.strict_match_compound_words,
            compare_mode: "LIKE BINARY",
            weight: 4,
            prefix: "%",
            postfix: "%",
            table: "product_eav_varchar"
        });
        sqlArr.push(sql_1_weight, sql_2_weight, sql_3_weight, sql_4_weight);
    }
    sqlArr = sqlArr.filter(item => (item != null && item.length > 0));
    if(sqlArr.length < 1) return null;
    sqlArr =
    `
    SELECT product_id, MAX(weight) AS weight, \'name\' AS \`type\` FROM (
        SELECT IF(\`pe\`.parent IS NOT NULL AND \`pe\`.parent != '', \`pe\`.parent, \`pe\`.entity_id) AS \`product_id\`, weight
        FROM (
            SELECT entity_id, SUM(weight) AS weight
            FROM (
                ${sqlArr.join(" UNION ALL ")}
            ) AS \`alias\`
            GROUP BY entity_id
        ) AS \`alias2\`
        INNER JOIN \`ecommerce\`.product_entity AS \`pe\` ON \`pe\`.entity_id = \`alias2\`.entity_id
    ) AS \`alias3\`
    GROUP BY product_id
    `;
    return sqlArr;
}

module.exports = {
    generateFulltextSqlSearchProductEntity
}