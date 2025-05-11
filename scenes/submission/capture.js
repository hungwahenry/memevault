// scenes/submission/capture.js
const { getSubmissionKeyboard } = require('../../utils/keyboards');

async function captureImage(ctx) {
  if (!ctx.message || !ctx.message.photo) {
    await ctx.reply('Please upload an image for your meme submission.');
    return;
  }
  
  // Get the largest photo size
  const photoSize = ctx.message.photo[ctx.message.photo.length - 1];
  ctx.wizard.state.imageFileId = photoSize.file_id;
  
  await ctx.reply(
    'Your meme image has been received! Would you like to add a caption?',
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '➕ Add Caption', callback_data: 'add_caption' },
            { text: '⏩ Skip Caption', callback_data: 'skip' }
          ]
        ]
      }
    }
  );
  
  return ctx.wizard.next();
}

async function captureCaption(ctx) {
  // If user selects skip, move to next step with empty caption
  if (ctx.callbackQuery && ctx.callbackQuery.data === 'skip') {
    await ctx.answerCbQuery();
    ctx.wizard.state.caption = '';
    
    // Show preview
    await ctx.replyWithPhoto(
      ctx.wizard.state.imageFileId,
      {
        caption: 'No caption',
        reply_markup: getSubmissionKeyboard().reply_markup
      }
    );
    
    await ctx.reply('Is this submission correct?');
    
    return ctx.wizard.next();
  }
  
  // If user wants to add caption
  if (ctx.callbackQuery && ctx.callbackQuery.data === 'add_caption') {
    await ctx.answerCbQuery();
    await ctx.reply('Please send your caption:');
    return;
  }
  
  // If user sent caption text
  if (ctx.message && ctx.message.text) {
    const caption = ctx.message.text;
    
    // Validate caption length
    if (caption.length > 200) {
      await ctx.reply('Caption is too long. Please keep it under 200 characters.');
      return;
    }
    
    ctx.wizard.state.caption = caption;
    
    // Show preview
    await ctx.replyWithPhoto(
      ctx.wizard.state.imageFileId,
      {
        caption: caption,
        reply_markup: getSubmissionKeyboard().reply_markup
      }
    );
    
    await ctx.reply('Is this submission correct?');
    
    return ctx.wizard.next();
  }
  
  // Handle other inputs
  if (!ctx.callbackQuery) {
    await ctx.reply('Please send your caption as text or select skip.');
  }
}

module.exports = {
  captureImage,
  captureCaption
};