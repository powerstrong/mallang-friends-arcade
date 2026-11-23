(function(root) {
  'use strict';
  // Field input and feedback. Reward rules live in engine/pet.js.
  root.MallangIdlePetUI = {
    create: function(opts) {
      var pet = root.MallangIdlePet.create(), pressedFriend = null;
      return {
        press: function(event) {
          pressedFriend = opts.stage.friendAt(event, opts.state());
        },
        cancel: function() { pressedFriend = null; },
        tap: function(event) {
          var s = opts.state(), stage = opts.stage;
          // Resolve moving sprites when the finger lands, before an attack or
          // formation transition can move them away from the release point.
          var friend = event.detail !== 0 && pressedFriend || stage.friendAt && stage.friendAt(event, s);
          pressedFriend = null;
          if (!friend) return false;
          var result = pet.tap(s, friend.id, opts.now(), friend.busy);
          stage.petFeedback(friend, result);
          if (result.animate) opts.sfx('tap');
          if (result.reward) opts.changed();
          if (result.limitReached) opts.toast('오늘은 충분히 쓰다듬었어요! 내일 또 만나요');
          return true;
        },
        hint: function() {
          var s = opts.state();
          if (!s.tutorialSeen.includes('petHint')) {
            opts.toast('친구를 톡 눌러 봐요');
            opts.markTutorial('petHint');
            opts.persist();
          }
        }
      };
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
