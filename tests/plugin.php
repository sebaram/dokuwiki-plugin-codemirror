<?php
namespace dokuwiki\Extension {
    class ActionPlugin {
        private bool $loaded = false;
        private array $config = [];
        public function loadConfig() {
            global $conf;
            $defaults = (static function () {$conf = []; include __DIR__ . '/../conf/default.php'; return $conf;})();
            $conf['plugin']['codemirrorenhanced'] = ($conf['plugin']['codemirrorenhanced'] ?? []) + $defaults;
            $this->config =& $conf['plugin']['codemirrorenhanced']; $this->loaded = true;
        }
        public function getConf($name) {if (!$this->loaded) $this->loadConfig(); return $this->config[$name];}
        public function getInfo() {return ['date' => '2026-10-25'];}
    }
    class Event {public array $data = [];}
    class EventHandler {
        public array $hooks = [];
        public function register_hook(...$args) {$this->hooks[] = $args;}
    }
    class PluginController {
        public static bool $legacyEnabled = false;
        public function isEnabled($name) {return $name === 'codemirror' && self::$legacyEnabled;}
    }
}
namespace {
    define('DOKU_INC', __DIR__ . '/../'); define('DOKU_BASE', '/wiki/');
    function getAcronyms() {return ['HTML' => 'HyperText'];}
    function getEntities() {return [];}
    function getSchemes() {return ['https'];}
    function getSmileys() {return [];}
    function check($condition, $message) {if (!$condition) throw new \RuntimeException($message);}
    require __DIR__ . '/../action.php';
    $plugin_controller = new \dokuwiki\Extension\PluginController();
    check(class_exists('action_plugin_codemirrorenhanced'), 'Fork must load through its distinct plugin class');
    $settings = ['codesyntax', 'nativeeditor', 'usenativescroll', 'autoheight'];
    $conf = ['camelcase' => 1, 'plugin' => ['codemirror' => array_fill_keys($settings, 1)]];
    $plugin = new \action_plugin_codemirrorenhanced();
    foreach ($settings as $name) check($plugin->getConf($name) === 1, 'Lost legacy setting: ' . $name);
    $conf = ['camelcase' => 1, 'plugin' => ['codemirror' => array_fill_keys($settings, 1), 'codemirrorenhanced' => ['codesyntax' => 0]]];
    $plugin = new \action_plugin_codemirrorenhanced();
    check($plugin->getConf('codesyntax') === 0, 'Explicit new setting must override legacy value');
    check($plugin->getConf('autoheight') === 1, 'Unset new setting must retain legacy value');
    $conf = ['camelcase' => 1, 'plugin' => []]; $plugin = new \action_plugin_codemirrorenhanced();
    foreach ($settings as $name) check($plugin->getConf($name) === '0', 'Fresh install defaults changed');
    $handler = new \dokuwiki\Extension\EventHandler();
    \dokuwiki\Extension\PluginController::$legacyEnabled = true; $plugin->register($handler);
    check(count($handler->hooks) === 0, 'Both enabled plugins must not initialize two editors');
    \dokuwiki\Extension\PluginController::$legacyEnabled = false; $plugin->register($handler);
    check(count($handler->hooks) === 1, 'New plugin must register when legacy editor is disabled or absent');
    $ACT = 'edit'; $event = new \dokuwiki\Extension\Event(); $plugin->handle_tpl_metaheader_output($event, null);
    $output = json_encode($event->data, JSON_UNESCAPED_SLASHES);
    check(strpos($output, '/wiki/lib/plugins/codemirrorenhanced/dist/scripts.min.js') !== false, 'Assets must load from the new folder');
    check(strpos($output, 'JSINFO.plugin_codemirrorenhanced = ') !== false, 'Client configuration must use the new plugin namespace');
    check(strpos($output, '/wiki/lib/plugins/codemirror/') === false, 'Assets must not depend on the removed old folder');
    echo "PASS distinct plugin identity, legacy settings, explicit overrides, fresh defaults and coexistence guard\n";
}
