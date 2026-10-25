<?php
/**
 * CodeMirror Enhanced for DokuWiki, maintained by sebaram
 *
 * @author Albert Gasset <albertgasset@fsfe.org>
 * @license GNU GPL version 2 or later
 */

if(!defined('DOKU_INC')) die();

class action_plugin_codemirrorenhanced extends \dokuwiki\Extension\ActionPlugin {

    static $actions = array('edit', 'create', 'source', 'preview',
                            'locked', 'draft', 'recover', 'show');

    public function loadConfig() {
        global $conf;
        foreach (array('nativeeditor', 'codesyntax', 'usenativescroll', 'autoheight') as $name) {
            if (!isset($conf['plugin']['codemirrorenhanced'][$name]) &&
                isset($conf['plugin']['codemirror'][$name])) {
                $conf['plugin']['codemirrorenhanced'][$name] = $conf['plugin']['codemirror'][$name];
            }
        }
        parent::loadConfig();
    }

    public function register(\dokuwiki\Extension\EventHandler $controller) {
        global $plugin_controller;
        // Keep one editor until the administrator disables the old plugin.
        if ($plugin_controller->isEnabled('codemirror')) {
            return;
        }
        $controller->register_hook('TPL_METAHEADER_OUTPUT', 'BEFORE',
                                   $this, 'handle_tpl_metaheader_output');
    }

    public function handle_tpl_metaheader_output(\dokuwiki\Extension\Event $event, $param) {
        global $ACT, $conf;

        if (!in_array($ACT, self::$actions)) {
            return;
        }

        $info = $this->getInfo();
        $version = str_replace('-', '', $info['date']) . '-' .
            filemtime(__DIR__ . '/dist/scripts.min.js');
        $base_url = DOKU_BASE . 'lib/plugins/codemirrorenhanced';
        $acronyms = array_keys(getAcronyms());
        usort($acronyms, function ($a, $b) { return strlen($b) <=> strlen($a); });

        $jsinfo = array(
            'acronyms' => $acronyms,
            'baseURL' => $base_url,
            'camelcase' => (bool) $conf['camelcase'],
            'codesyntax' => $this->getConf('codesyntax'),
            'entities' => array_keys(getEntities()),
            'iconURL' => "$base_url/settings.png",
            'nativeeditor' => $this->getConf('nativeeditor'),
            'schemes' => array_values(getSchemes()),
            'smileys' => array_keys(getSmileys()),
            'version' => $version,
            'usenativescroll' => $this->getConf('usenativescroll'),
            'autoheight' => $this->getConf('autoheight'),
        );

        $event->data['link'][] = array(
            'rel' => 'stylesheet',
            'type' => 'text/css',
            'href' => "$base_url/dist/styles.min.css?v=$version",
        );

        $event->data['script'][] = array(
            'type' => 'text/javascript',
            '_data' => 'JSINFO.plugin_codemirrorenhanced = ' . json_encode($jsinfo,
                JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT) . ';',
        );

        $event->data['script'][] = array(
            'type' => 'text/javascript',
            'charset' => 'utf-8',
            'src' => "$base_url/dist/scripts.min.js?v=$version",
            'defer' => 'defer',
        );
    }
}
